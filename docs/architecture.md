# Architecture

```
 Phone / browser ──HTTPS──┐                         ┌── PostgreSQL 16
   (Next.js PWA)          │   ┌──────────────────┐  │   (state, history, users, automations)
                          ├──▶│ reverse proxy    │  │
 Integrations ──HTTPS─────┤   │ TLS, /api → Node │  │
   (API keys)             │   └────────┬─────────┘  │
                          │            ▼            │
 ESP32 boards ──WSS───────┘   ┌──────────────────┐  │
   (signed messages)          │ Node.js backend  │──┘
                              │ Fastify, 1 process│
                              └──────────────────┘
```

**Production:** one Node.js process plus one PostgreSQL database. That is enough for the target of about 150
homes and 1.5–3k devices, a few thousand idle WebSockets. There is no Redis and no queue: the database is the
single source of truth.

## Repository

| Path                | What                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol` | Shared by backend, frontend, simulator: envelope schema, signing, raw-payload scanner, capability registry, device templates, limits, test vectors |
| `backend`           | Fastify API, device gateway, browser realtime socket, automation engine, jobs                                                                      |
| `frontend`          | Next.js App Router web app (PWA), TanStack Query, Tailwind CSS                                                                                     |
| `firmware`          | ESP32 SDK + stock board firmware ([firmware.md](firmware.md))                                                                                      |
| `tools/device-sim`  | Virtual boards speaking the real protocol: tests, demo data, load tests                                                                            |

## Backend modules (`backend/src/modules`)

| Module        | Responsibility                                                                         |
| ------------- | -------------------------------------------------------------------------------------- |
| auth          | register, login, email verification, password reset, sessions (JWT + rotating refresh) |
| homes         | homes, rooms, members, invites, member permissions                                     |
| controllers   | boards: create (key + secret), regenerate secret, restart, delete                      |
| devices       | devices, actions, activity, state application (`applyState`)                           |
| templates     | built-in and custom device types, firmware snippet generator                           |
| gateway       | device WebSocket: handshake, signing, replay guard, pending commands, heartbeats       |
| realtime      | browser WebSocket `/api/v1/ws`: per-home fan-out of state/online/notification events   |
| scenes        | named sets of device actions                                                           |
| automations   | schedules, timers, sun events, device triggers, conditions, actions; one engine        |
| notifications | in-app, web push (VAPID), email; per-user preferences                                  |
| telemetry     | sensor readings, hourly rollups, history charts                                        |
| energy        | estimated consumption (on-time × rated watts × level) and measured power               |
| api-keys      | personal API keys with scopes                                                          |
| ota           | firmware releases, rollouts, one-time download links                                   |
| admin         | platform admin: users, homes, boards, firmware, audit                                  |
| audit         | security-relevant actions log                                                          |
| maintenance   | partitions, rollups, retention, OTA pacing (advisory-lock single runner)               |

## Main flows

**Command** (tap in app, API call, scene, schedule):
1. `POST /api/v1/devices/:id/actions`.
2. The backend checks auth, the caller's home role and member permission, and validates the value against the
   device's capabilities.
3. It signs the command and sends it to the board. The command waits in a pending map keyed by replyToken, for
   at most 8 s.
4. The board answers with the resulting state.
5. `applyState` takes over (step list below).

**Physical / sensor event:**
1. The board sends a signed event.
2. The backend checks the per-device token bucket.
3. `applyState` takes over.

**`applyState`** is the single path every state change takes:
1. Update `device_state`.
2. Append to `device_events` (activity).
3. Book energy.
4. Store sensor readings.
5. Fan out to the browsers watching that home.
6. Evaluate device-triggered automations.

**Board connect / disconnect:**
1. On handshake, the backend auto-creates devices for new channels.
2. It sends `config`, restores states and offers OTA.
3. On disconnect it starts a 10 s grace timer, then marks the board offline.
4. Owners are notified after 5 minutes offline.

**Automations:**
- A 5 s ticker claims due time-based automations with `FOR UPDATE SKIP LOCKED`: cron, sunrise/sunset with
  offset, one-off timers. This is safe even if a second instance is ever added.
- Device and threshold triggers are evaluated in `applyState`, with hysteresis.
- Loop guard: chain depth 3, plus a per-automation cooldown.

## Data

PostgreSQL 16 through Drizzle ORM. Migrations are SQL in `backend/src/db/migrations`.

High-volume history is partitioned:

| Table                   | Partitioning | Retention |
| ----------------------- | ------------ | --------- |
| `device_events`         | monthly      | 90 days   |
| `sensor_readings`       | daily        | 30 days   |
| `sensor_rollups_hourly` | —            | 2 years   |

Partitions are created ahead and dropped past retention by the maintenance job, so deleting old data is
instant.

Board secrets are AES-256-GCM encrypted at rest. See [security.md](security.md).

## Scaling beyond one process

`bus.ts` is the in-process event bus between the gateway, realtime and automations. Running two backend
instances would need two changes:
- swap the bus for PostgreSQL `LISTEN/NOTIFY`;
- route a board's commands to the instance that holds its socket.

Neither is needed at the current size.
