# Operations

Running Voltix in production. This repo deliberately contains no hosting configuration; this page lists what
the server needs, so it can be set up on Hostinger or anywhere else.

## What to rent

Voltix needs:
- a long-running Node.js process that holds WebSockets;
- PostgreSQL.

Shared web hosting can't run either, so use a **VPS** (for example Hostinger KVM). The target size is about 150
homes and 3k devices; **2 vCPU / 4 GB RAM / 40 GB SSD** is comfortable for that.

Software on the VPS:
- Node.js 24 LTS;
- PostgreSQL 16;
- a reverse proxy with TLS: Nginx or Caddy with Let's Encrypt;
- an SMTP mailbox for account emails (Hostinger mail works).

## Domain and TLS

Use one domain, for example `voltix.example.com`:

- `https://voltix.example.com/`: the web app (Next.js, port 3000).
- `https://voltix.example.com/api/…`: the backend (port 4000). The proxy must:
  - pass WebSocket upgrades for `/api/v1/device` and `/api/v1/ws`;
  - keep idle sockets open for at least 120 s;
  - forward `X-Forwarded-For`.

A Let's Encrypt certificate works for boards out of the box (see [firmware.md](firmware.md#tls)).

## Configuration

Copy `backend/.env.example` to `backend/.env` on the server and set:

| Variable                         | Production value                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                       | `production`                                                                                            |
| `APP_ORIGIN` / `API_ORIGIN`      | `https://voltix.example.com` (both, when served from one domain)                                        |
| `DATABASE_URL`                   | `postgres://voltix:<strong password>@localhost:5432/voltix`                                             |
| `JWT_SECRET`                     | 32+ random characters                                                                                   |
| `SECRET_ENC_KEY`                 | 32 random bytes, base64 (encrypts board secrets; back it up separately, see [security.md](security.md)) |
| `COOKIE_SECURE`                  | `true`                                                                                                  |
| `TRUST_PROXY`                    | address of the reverse proxy (`127.0.0.1` when on the same VPS)                                         |
| `REQUIRE_EMAIL_VERIFICATION`     | `true`                                                                                                  |
| `SMTP_*`, `MAIL_FROM`            | your mailbox                                                                                            |
| `VAPID_*`                        | from `npx web-push generate-vapid-keys` (browser push notifications)                                    |
| `STORAGE_DIR`                    | persistent folder for firmware images, e.g. `/var/lib/voltix`                                           |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first platform admin, created by `db:seed`; change the password after first login                       |

Generate random values with:
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

For the frontend, set `API_PROXY_TARGET=http://127.0.0.1:4000` if Next.js should proxy `/api`. Leave it unset
when the reverse proxy routes `/api` to the backend directly; that is the better option.

## Build, migrate, run

```bash
npm ci
npm run build                 # backend (tsup) + frontend (next build)
npm run db:migrate            # applies backend/src/db/migrations, safe to re-run
npm run db:seed               # built-in device templates + first admin; safe to re-run
node --env-file=backend/.env backend/dist/main.js         # API, port 4000
npm run start -w @voltix/frontend                         # web app, port 3000
```

Run both under a process manager (systemd or pm2) with automatic restart. Run **one** backend instance; see
[architecture.md](architecture.md#scaling-beyond-one-process).

The backend runs its own housekeeping:
- hourly: partitions, sensor rollups, energy, retention;
- every minute: OTA pacing.

No cron setup is needed.

### Updating

1. `git pull`
2. `npm ci && npm run build`
3. `npm run db:migrate`
4. Restart the backend, then the frontend.

Boards reconnect on their own within seconds, with jittered backoff. Browsers reconnect and refetch.

## Backups

Not automated by this repo. Set up:

- A nightly `pg_dump -Fc voltix > voltix-$(date +%F).dump`, copied off the server. Keep 14 daily and 8 weekly
  dumps.
- A copy of `STORAGE_DIR` (firmware images) and of `backend/.env`. Store `SECRET_ENC_KEY` apart from the dumps.
- A restore test every few months:
  1. `createdb voltix_restore`
  2. `pg_restore -d voltix_restore <dump>`
  3. Point a staging copy at it.

## Monitoring

- `GET /api/health` for uptime checks (public, checks the database).
- **Admin → Overview** shows online boards, homes and users. **Admin → Audit** shows security events.
- Logs are JSON from pino on stdout; ship them to `journalctl` or a file. Secrets and cookies are redacted.
- Watch for: database size growth (history tables are partitioned and pruned automatically), many boards
  offline at once (network or TLS problem), and 401 bursts on `/api/v1/device` (secrets changed or clock
  issues).

## Firmware releases

See [firmware.md](firmware.md#ota-updates). Upload under **Admin → Firmware**, roll out to one home first,
then to everyone. Boards update 20 at a time.

## Development helpers

```bash
npm run dev:db                         # PostgreSQL :5433 + Mailpit :8025 (Docker)
npx tsx tools/device-sim/src/cli.ts --key <vxc_…> --secret <…> --channels 1:switch,5:fan   # one virtual board
DEMO_EMAIL=… DEMO_PASSWORD=… npm run demo -w @voltix/device-sim                         # fill a demo home
npm run test:firmware                  # firmware protocol tests (needs g++, clang++ or MSVC)
```
