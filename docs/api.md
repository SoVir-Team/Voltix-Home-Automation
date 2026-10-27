# REST API

Base URL: `https://<your-domain>/api/v1`.

The full interactive reference (OpenAPI) is served at **`/api/docs`**. This page covers what you need to
integrate.

## Authentication

**Web app:** session cookies set by `/auth/login` and refreshed by `/auth/refresh`. Browser requests that change
state must come from the app's own origin.

**Integrations:** create a personal API key under **Account → API keys**. Pick its scopes and, optionally, an
expiry. The key is shown once. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer vx_ab12cd34_…" https://voltix.example.com/api/v1/homes
```

| Scope             | Allows                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `homes:read`      | `GET /homes`, `GET /homes/:homeId`, `GET /homes/:homeId/rooms`, `GET /homes/:homeId/scenes` |
| `devices:read`    | `GET /homes/:homeId/devices`, `GET /devices/:deviceId`, `GET /devices/:deviceId/history`    |
| `devices:control` | `POST /devices/:deviceId/actions`                                                           |
| `scenes:run`      | `POST /scenes/:sceneId/run`                                                                 |

An API key acts as its owner, limited to these routes and scopes. It can never use admin routes.

## Controlling a device

```bash
curl -X POST https://voltix.example.com/api/v1/devices/$DEVICE/actions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"action":"setPowerState","value":{"state":"On"}}'
# → {"state":{"powerState":"On", ...}}
```

The available actions and their values for each device type are listed in [protocol.md](protocol.md#4-commands-cloud--board--cloud)
and in the capability registry. The response is the device's state after the board confirmed the change.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "DEVICE_OFFLINE", "message": "Hall Light is offline" } }
```

| Status | Typical codes                                        |
| ------ | ---------------------------------------------------- |
| 400    | `VALIDATION_ERROR` (with `details`)                  |
| 401    | not signed in, invalid or expired API key            |
| 403    | role or scope too low, member permission missing     |
| 404    | not found, or not a member of that home              |
| 409    | `DEVICE_OFFLINE`, conflicts                          |
| 429    | rate limited                                         |
| 504    | `DEVICE_TIMEOUT`: the board didn't answer within 8 s |

**Rate limits:**
- 300 requests/min per client in general;
- 10/min on auth routes;
- 60 per 10 s on device actions;
- 20 per 10 s on scene runs.

## Live updates

A browser session can open `wss://<domain>/api/v1/ws` (cookie auth) and send
`{"type":"subscribe","homeId":"…"}`. It then receives:

| Event              | Payload                                           |
| ------------------ | ------------------------------------------------- |
| `device.state`     | `deviceId`, `state`, `source`, `at`               |
| `device.online`    | `controllerId`, `online`, `deviceIds`, `at`       |
| `device.changed`   | `deviceId` (renamed, moved, deleted: refetch)     |
| `notification.new` | `notification`                                    |
| `automation.run`   | `automationId`, `status`, `at`                    |
| `ota.progress`     | `controllerId`, `rolloutId`, `status`, `progress` |

Send `{"type":"ping"}` every ~25 s to keep proxies from closing the socket.

## Route map

Grouped by area. Unless marked **API key**, routes need a signed-in session.

- **Auth:** `POST /auth/register` `login` `logout` `refresh` `verify-email` `resend-verification`
  `forgot-password` `reset-password`
- **Me:** `GET/PATCH /me`, `POST /me/password`, `GET /me/sessions`, `DELETE /me/sessions/:id`,
  `GET/POST /me/api-keys`, `DELETE /me/api-keys/:id`
- **Homes:**
  - `GET/POST /homes` (GET: API key)
  - `GET/PATCH/DELETE /homes/:homeId` (GET: API key)
  - `GET/POST /homes/:homeId/rooms` (GET: API key), `PATCH/DELETE /rooms/:roomId`
  - `GET /homes/:homeId/members`, `PATCH/DELETE /homes/:homeId/members/:userId`
  - `POST /homes/:homeId/invites`, `DELETE /homes/:homeId/invites/:inviteId`
  - `GET /invites/:token`, `POST /invites/accept`
- **Boards:**
  - `GET/POST /homes/:homeId/controllers`
  - `GET/PATCH/DELETE /controllers/:controllerId`
  - `POST /controllers/:controllerId/regenerate-secret`, `restart`, `update`
  - `GET /homes/:homeId/firmware`
- **Devices:**
  - `GET /homes/:homeId/devices` (API key)
  - `GET/PATCH/DELETE /devices/:deviceId` (GET: API key)
  - `POST /devices/:deviceId/actions` (API key)
  - `GET /devices/:deviceId/history` (API key)
  - `GET /homes/:homeId/activity`
- **Scenes:** `GET/POST /homes/:homeId/scenes` (GET: API key), `PATCH/DELETE /scenes/:sceneId`,
  `POST /scenes/:sceneId/run` (API key)
- **Automations:** `GET/POST /homes/:homeId/automations`, `PATCH/DELETE /automations/:automationId`,
  `POST /automations/:automationId/run`, `GET /automations/:automationId/runs`
- **Energy:** `GET /homes/:homeId/energy`
- **Notifications:** `GET /notifications`, `POST /notifications/read`, `GET/PUT /notifications/prefs`,
  `GET /push/vapid-public-key`, `POST/DELETE /push/subscriptions`
- **Templates:** `GET/POST /templates`, `DELETE /templates/:id`, `POST /templates/firmware` (sketch generator)
- **Admin** (platform admins only):
  - `GET /admin/stats` `users` `homes` `boards` `audit`
  - `PATCH /admin/users/:id`
  - `GET/POST /admin/firmware`, `DELETE /admin/firmware/:id`
  - `GET/POST /admin/rollouts`, `GET /admin/rollouts/:id`, `POST /admin/rollouts/:id/cancel`
- **Devices only:** `GET /device` (board WebSocket, [protocol.md](protocol.md)), `GET /ota/download/:token`
