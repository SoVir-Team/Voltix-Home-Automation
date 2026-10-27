# Security

What protects whom, and what is left to the operator.

## Threats considered

| Threat                                        | Control                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone forges or replays commands to a board | TLS; every message HMAC-signed over its exact bytes; 60 s freshness window; per-direction replyToken replay guard on both ends                                                                              |
| A stolen board secret                         | Secrets are per board, not per account: a leak exposes one board only. Regenerating the secret in the app disconnects it (close 4002)                                                                       |
| Database leak                                 | Passwords: argon2id. Board secrets: AES-256-GCM with `SECRET_ENC_KEY`, which is kept out of the database. API keys and refresh tokens: stored only as SHA-256 hashes                                        |
| Account takeover by password guessing         | Rate limits (10/min on auth routes), login attempt window, uniform error messages                                                                                                                           |
| Session theft                                 | 15 min access JWT + 30-day refresh token in httpOnly, Secure, SameSite=Lax cookies. Refresh tokens rotate; reusing an old one revokes the whole family. Users can see and revoke sessions                   |
| CSRF                                          | State-changing browser requests must carry the web app's `Origin` (cookie auth). API keys use `Authorization: Bearer`, so CSRF doesn't apply to them                                                        |
| A member seeing or controlling another home   | Every home route checks membership and role (owner/admin/member). Non-members get 404 so homes can't be probed. Owners set per-area permissions for plain members (locks & garage doors, lighting, climate) |
| An integration key doing too much             | API keys carry scopes (`homes:read`, `devices:read`, `devices:control`, `scenes:run`), can expire, are refused on every other route, and never have platform-admin rights                                   |
| Malicious firmware pushed to boards           | Only platform admins upload firmware. Download links are one-time and expire in 15 min. Boards verify size and SHA-256 before installing, and roll back if the new image can't reach the cloud              |
| Oversized or malformed input                  | zod validation on every route and every WebSocket message; 8 KB device frames, 4 KB browser frames, 4 MB firmware uploads                                                                                   |
| Abuse by a misbehaving board                  | Per-device event token bucket, telemetry throttling, 10 invalid messages close the socket                                                                                                                   |
| Board setup secret sniffed over the air       | The setup Wi-Fi is open, but only while the portal runs (during setup, or 5 min after a failed Wi-Fi join). Regenerate the secret if setup happened somewhere untrusted                                     |
| Script injection in the web app               | React escapes all output (no raw HTML anywhere). A Content-Security-Policy allows scripts and connections only from the app's own origin, and blocks framing and plugins. HSTS in production                |
| Phishing via a crafted sign-in link           | `?next=` after sign-in is parsed as a URL and followed only when it stays on the app's origin                                                                                                               |

Every security-relevant action goes to `audit_log`, kept for one year: logins, password and session changes,
API keys, members and invites, board secrets, firmware and rollouts, admin changes. Platform admins see it
under Admin → Audit.

Logs redact authorization headers, cookies, passwords and secrets.

### Known limits (accepted)

- **Access tokens live out their 15 minutes.** Disabling a user, removing admin rights or resetting a
  password revokes every refresh token at once, but an already-issued access token keeps working until it
  expires. Home membership is checked on every request, so removing someone from a home is immediate.
- **Browser live updates** check membership when a home is subscribed. Someone removed from a home keeps
  receiving that home's live events until their page reconnects (at most until their session ends).
- **Board handshake replay.** A captured handshake could be replayed within its 60 s window to take over
  the board's connection. Capturing one needs a TLS break, and the replayer still can't sign messages, so
  it can't control anything or fake events.
- **Registration says when an email is taken.** That is a deliberate usability trade-off; the route is
  rate-limited (10/min per IP). Password reset gives the same answer either way.
- **CSP allows inline scripts** (`'unsafe-inline'`). Next.js's bootstrap scripts are inline; nonces would
  make every page server-rendered on each request.

### Review log

- 2026-10-27, full review against the OWASP Top 10 checklist. Fixed:
  - Admin routes could be reached by non-admins through a percent-encoded path (`/api/v1/%61dmin/…`); the
    guard compared the raw URL. Now every route in the admin module requires a platform admin; test added.
  - Open redirect after sign-in via a tab or newline in `?next=`.
  - The web app sent no CSP.
  - `npm audit --omit=dev`: no known vulnerabilities.

## Operator responsibilities

- Serve everything over HTTPS with a valid certificate. Boards trust Let's Encrypt roots by default.
- Set `COOKIE_SECURE=true` and a production `APP_ORIGIN` / `API_ORIGIN`.
- Generate `SECRET_ENC_KEY` once (32 random bytes, base64) and back it up **separately** from database
  backups. If it is lost, every board must be re-provisioned. If it leaks along with a backup, the board
  secrets are exposed.
- Generate the JWT signing key and VAPID keys once; keep `.env` readable only by the service user.
- Keep the database port closed to the internet.
- Rotate any credential that was ever shared in chat, email or a repository. The Wi-Fi password found in the
  old LAN firmware folder should be changed.

## Reporting a problem

Email the platform admin. Don't open a public issue for vulnerabilities.
