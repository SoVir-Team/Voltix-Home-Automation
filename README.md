<div align="center">

<img src="frontend/public/brand/icon.svg" width="88" height="88" alt="Voltix logo" />

# Voltix Home Automation

### One home. Every device. Connected.

Control your home, build everyday routines, and understand your energy use.<br />
A complete platform spanning the web app, device gateway, and ESP32 firmware.

![Node.js](https://img.shields.io/badge/Node.js-24_recommended-339933?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![ESP32](https://img.shields.io/badge/Hardware-ESP32-E7352C?logo=espressif&logoColor=white)

[Quick start](#quick-start) · [Features](#what-you-can-do) · [How it works](#how-voltix-works) · [User guide](#your-first-home) · [Firmware](#connect-a-real-esp32) · [Deployment](#deploying-voltix)

</div>

---

Voltix turns ESP32 controllers into connected switches, lights, fans, and sensors. Use a phone or computer to manage rooms, run scenes, schedule actions, follow live activity, and share control with family. The same backend handles commands from the app, integrations, and automations, then publishes confirmed device state to connected browsers.

The repository includes the application, API, shared protocol, firmware SDK, stock controller sketch, and a simulator. You can explore a complete demo home before connecting any hardware.

> **Hardware scope:** the stock controller has four light relays and two fan relays. Other device types have software templates and controls, but need suitable hardware and firmware handlers. Fan-speed output, wall-switch inputs on the stock board, and real-board validation are covered under [current boundaries](#current-boundaries).

## Explore this README

- [What you can do](#what-you-can-do)
- [Technology stack](#technology-stack)
- [How Voltix works](#how-voltix-works)
- [Quick start](#quick-start)
- [Try it without hardware](#try-it-without-hardware)
- [Your first home](#your-first-home)
- [Connect a real ESP32](#connect-a-real-esp32)
- [Integrations and API](#integrations-and-api)
- [Configuration reference](#configuration-reference)
- [Security model](#security-model)
- [Project map](#project-map)
- [Development and verification](#development-and-verification)
- [Deploying Voltix](#deploying-voltix)
- [Troubleshooting](#troubleshooting)
- [Current boundaries](#current-boundaries)
- [Further documentation](#further-documentation)

## What you can do

| Area                        | Available functionality                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home dashboard**          | See connected devices and room summaries, access controls, and run scenes from a responsive web interface.                                                                                                             |
| **Homes and rooms**         | Manage multiple homes, switch between them, create and rename rooms, choose icons, and assign devices to rooms.                                                                                                        |
| **Device controls**         | Turn devices on/off and use controls matched to their capabilities: power level, brightness, colour, colour temperature, climate, media, locks, modes, and position. Hardware must implement the corresponding action. |
| **Live state and activity** | Receive device state and connectivity updates over WebSockets. Inspect device activity and sensor history.                                                                                                             |
| **Scenes**                  | Save named groups of device actions and run them together, such as a bedtime or movie routine.                                                                                                                         |
| **Automations**             | Run recurring schedules, one-off timers, daily start/end windows, sunrise/sunset rules, and device-state or sensor-threshold triggers. Add conditions, device actions, scenes, notifications, and delays.              |
| **Energy insights**         | View weekly, monthly, and yearly consumption, device breakdowns, comparisons with the previous period, and cost estimates using your home's tariff and currency.                                                       |
| **Family access**           | Invite people by email, assign owner/admin/member roles, and set home-wide member permissions for lighting, climate/fans, locks, and energy reports.                                                                   |
| **Notifications**           | In-app alerts, optional browser push, and email preferences for doorbell, motion, contact, offline-device, automation, OTA, and security events. Delivery depends on configuration and user permission.                |
| **Board management**        | Add controllers, view connectivity and firmware information, rename or restart boards, and regenerate credentials. New channels are discovered when a board connects.                                                  |
| **Device templates**        | Use built-in types, create custom capability templates, and generate Arduino sketches with channel, relay, and switch-input assignments.                                                                               |
| **Account controls**        | Register, verify email, reset/change passwords, update your profile, inspect and revoke sessions, and manage scoped API keys.                                                                                          |
| **Platform administration** | View users, homes, boards, platform statistics, firmware releases, rollouts, and audit events. Home admins and platform admins have separate responsibilities.                                                         |
| **Firmware updates**        | Upload model-specific firmware and start paced OTA rollouts, with progress, checksum validation, and rollback when the ESP32 build supports it.                                                                        |
| **Installable web app**     | PWA manifest, app icons, and a push service worker. Installation and push availability depend on the browser.                                                                                                          |

### Built-in device types

The shared registry defines **17 templates**. A template describes capabilities; the connected board supplies the physical implementation.

| Category            | Templates                                                                                         | Controls or readings                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Lighting and power  | Switch, dimmable switch, smart light                                                              | On/off; level; brightness, RGB colour, and colour temperature where supported                            |
| Climate             | Fan, thermostat, air conditioner                                                                  | Power, level, thermostat controls, and temperature readings according to type                            |
| Entertainment       | TV, speaker                                                                                       | Power, volume, media playback, input selection; TV channel control                                       |
| Access and movement | Smart lock, garage door, blinds                                                                   | Lock/unlock, open/close mode, or position according to type                                              |
| Sensors and alerts  | Doorbell, motion sensor, door/window sensor, temperature sensor, air-quality sensor, energy meter | Doorbell events, motion/contact state, temperature/humidity, particulate readings, power/voltage/current |

### Routines that fit daily life

- **Before sunrise:** use a sun trigger with an offset and weekday filter to turn on entrance lights. Set the home's location first.
- **Evening schedule:** use a daily window to turn a device on at the start and off at the end, including windows crossing midnight.
- **Sensor response:** when a temperature reading crosses a threshold, run a device action or scene. Hysteresis helps prevent repeated firing near the threshold.
- **One tap before bed:** run a scene containing the device states you want.

Time-based rules use the **home's time zone**. Device triggers fire on qualifying transitions. Cooldowns and a chain-depth guard limit automation loops. The scheduler runs in the backend, so server availability matters.

## Technology stack

| Layer                        | Technologies                                           | Responsibility                                                           |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Web application              | Next.js 16 App Router, React 19, TypeScript 6          | Pages, account flows, dashboards, and device controls                    |
| UI and client state          | Tailwind CSS 4, TanStack Query 5, Lucide React, Sonner | Responsive layouts, server-data caching, icons, and feedback             |
| API and gateway              | Node.js, Fastify 5, TypeScript, WebSockets (`ws`)      | REST API, authenticated browser/device sockets, and command delivery     |
| Validation and API reference | Zod 4, Fastify Swagger/OpenAPI                         | Input validation and interactive API documentation                       |
| Database                     | PostgreSQL 16, Drizzle ORM, `postgres`                 | Users, memberships, device state, history, rules, energy, and audit data |
| Identity and cryptography    | Argon2id, JOSE/JWT, Node.js crypto                     | Password hashing, sessions, signing, and secret encryption               |
| Scheduling                   | `cron-parser`, SunCalc                                 | Cron expressions, home-local schedules, sunrise, and sunset              |
| Messaging                    | Nodemailer, Web Push/VAPID                             | Account emails and notification delivery                                 |
| Shared protocol              | TypeScript, Zod, HMAC-SHA256, shared test vectors      | Capabilities, templates, message envelopes, signing, and protocol limits |
| Embedded firmware            | ESP32, Arduino framework, PlatformIO                   | Controller firmware and reusable Voltix SDK                              |
| Embedded libraries           | ArduinoJson 7, links2004/WebSockets 2.6, WiFiManager 2 | Messages, connections, and Wi-Fi provisioning                            |
| Local services               | Docker Compose, PostgreSQL, Mailpit                    | Development database and captured email                                  |
| Developer tooling            | npm workspaces, Vitest, Biome, tsx, tsup               | Monorepo commands, tests, linting, development, and backend builds       |

Versions above describe the package manifests. `package-lock.json` records resolved JavaScript dependencies; `firmware/platformio.ini` defines the embedded build.

## How Voltix works

### The architecture

```mermaid
flowchart LR
    Browser[Phone or browser / Next.js PWA]
    Integration[Integration / scoped API key]
    Proxy[HTTPS reverse proxy]
    API[Fastify API and device gateway]
    DB[(PostgreSQL)]
    Engine[Automation engine and maintenance]
    Board[ESP32 controller / Voltix SDK]
    Hardware[Relays, switch inputs, sensors]

    Browser -->|REST and browser WebSocket| Proxy
    Integration -->|REST| Proxy
    Board <-->|Signed device WebSocket| Proxy
    Proxy <--> API
    API <--> DB
    API <--> Engine
    Board <--> Hardware
```

Development connects to the backend directly or through the Next.js HTTP proxy. Production uses a TLS reverse proxy that forwards both HTTP requests and WebSocket upgrades. The backend currently runs as **one process**, with PostgreSQL as persistent storage and an in-process event bus for live events.

### The vocabulary

| Term                   | Meaning                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| **Home**               | The boundary for rooms, boards, devices, people, permissions, scenes, and automations.                   |
| **Room**               | A named group of devices inside a home.                                                                  |
| **Controller / board** | One ESP32 with its own credentials and connection. One board can expose several channels.                |
| **Channel**            | A numbered endpoint on a board, such as channel 1 for a light relay.                                     |
| **Device**             | The app's representation of a channel, including its name, room, capabilities, configuration, and state. |
| **Template**           | The capabilities and available actions/readings of a device type.                                        |
| **Scene**              | A saved collection of device actions, run on demand or by an automation.                                 |
| **Automation**         | A trigger plus optional conditions and an ordered list of actions.                                       |

### From a tap to a relay

1. You tap a control. The app sends an action to `/api/v1/devices/:deviceId/actions`.
2. The API checks authentication, home access, member permissions, and the device's capabilities.
3. The gateway signs the command and sends it to the board holding that channel.
4. The firmware applies the action and replies with the resulting state.
5. The backend updates stored state, records activity, updates energy/telemetry as applicable, and evaluates device-triggered automations.
6. A live event updates browsers subscribed to that home.

A physical switch or sensor event enters the same state-processing path after validation. Commands wait up to **8 seconds** for a reply; offline boards and missing replies return explicit errors.

### When connectivity changes

- Boards authenticate using a board key and secret, announce their channels, and receive configuration. Previously unseen channels become devices automatically.
- After disconnect, a short grace period avoids immediate offline flicker. Owners/admins receive an alert if a board stays offline for five minutes.
- The firmware retries connections with backoff. Configured local switch inputs keep working without the network, and offline changes are reported after reconnect.
- Power-on behavior can be **Off**, **Last state**, or **Cloud**. Local state/configuration is stored in NVS; cloud restoration needs a connection.
- App control and backend automations require the backend connection. The PWA deliberately does not cache device state for offline control.

## Quick start

### 1. Prerequisites

- **Node.js 24 recommended**; the repository declares Node.js `>=22.12`.
- npm, Git, and Docker Desktop with the Docker engine running, or equivalent PostgreSQL/SMTP services.
- Ports **3000**, **4000**, **5433**, **1025**, and **8025** available for the default setup.
- Hardware is optional. For real boards, add an ESP32, a USB data cable, and PlatformIO.

### 2. Clone and install

```bash
git clone https://github.com/SoVir-Team/Voltix-Home-Automation.git
cd Voltix-Home-Automation
npm ci
npm run dev:db
```

Docker Compose starts PostgreSQL and Mailpit. It does **not** start the application servers. Database data persists in the `voltix_pg` Docker volume.

### 3. Configure the backend

From the repository root, use PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

Or macOS/Linux:

```bash
cp backend/.env.example backend/.env
```

The example matches the local Docker services. Before seeding, set your preferred `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `backend/.env`. Generate your own `JWT_SECRET` and `SECRET_ENC_KEY` for any shared or deployed environment; see [configuration](#configuration-reference).

> Keep `backend/.env` private. The example admin password and local database password are development placeholders.

### 4. Initialize the database

Wait for PostgreSQL to become healthy, then run:

```bash
npm run db:migrate
npm run db:seed
```

Migrations create the schema. Seeding creates the configured platform admin, a home, and starter rooms when that account is new. It does not add hardware or simulated boards. If admin variables are omitted, seeding creates no admin. Built-in device templates come from the shared registry rather than the seed script.

### 5. Start both servers

In one terminal at the repository root:

```bash
npm run dev:backend
```

In a second terminal:

```bash
npm run dev:frontend
```

| Service          | Local address                                                 | Purpose                                                             |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Web app          | [localhost:3000](http://localhost:3000)                       | Register, log in, and manage your home                              |
| Backend          | [localhost:4000/api/health](http://localhost:4000/api/health) | Database-aware health check                                         |
| API reference    | [localhost:4000/api/docs](http://localhost:4000/api/docs)     | Interactive endpoint schemas                                        |
| Mailpit          | [localhost:8025](http://localhost:8025)                       | Read development verification, reset, and invitation emails         |
| PostgreSQL       | `localhost:5433`                                              | Database`voltix`; local credentials in the example configuration    |
| Development SMTP | `localhost:1025`                                              | Captures messages in Mailpit; does not deliver them to real inboxes |

Log in with the admin credentials you configured, or register a separate account. Registration creates a home for the new account. Email verification is optional in the default development configuration.

The frontend ships a public `frontend/.env.development` that sends development browser WebSockets directly to port 4000. `frontend/.env.example` documents the optional HTTP proxy and WebSocket settings. The default Next.js HTTP proxy already targets `http://localhost:4000`.

## Try it without hardware

### Populate a complete demo home

Keep the backend and frontend running. Use an **existing Voltix account**; the demo script signs in rather than registering one.

PowerShell:

```powershell
$env:DEMO_EMAIL = 'you@example.com'
$env:DEMO_PASSWORD = 'your-account-password'
npm run demo -w @voltix/device-sim
```

macOS/Linux:

```bash
DEMO_EMAIL='you@example.com' DEMO_PASSWORD='your-account-password' npm run demo -w @voltix/device-sim
```

The script uses the account's **first home**, creates four virtual boards and **17 devices** across Living Room, Bedroom, Kitchen, and Entrance, and keeps them connected. Explore lights, a fan, TV, AC, blinds, a lock, a garage door, and sensor updates. Sensors report every 15 seconds; motion changes are simulated periodically.

Refresh the app, control a device, and watch the simulator print commands. Keep the simulator terminal open; **Ctrl+C** stops the boards. Later runs reuse board credentials stored under the ignored `tools/device-sim/.demo/` directory. Demo rooms/devices remain in the database after you stop it. If you delete the home or regenerate its board secrets, remove the corresponding local demo credential file before recreating that demo.

### Exercise the Add Device wizard

1. In the app, open **Devices → Add Device** as a home owner/admin.
2. Create a board and copy its key and one-time secret.
3. Run this from the repository root, replacing the placeholders:

```bash
npx tsx tools/device-sim/src/cli.ts --key YOUR_BOARD_KEY --secret YOUR_BOARD_SECRET --channels 1:switch,2:switch,5:fan --sensor
```

The default device endpoint is `ws://localhost:4000/api/v1/device`. `--sensor` adds a temperature sensor on channel 7. The wizard discovers the board's devices; name them and assign rooms. Type a switch channel number followed by Enter in the simulator to simulate a wall-switch interaction.

## Your first home

| Step | In the app                   | What to do                                                                                                                       |
| ---- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Settings**                 | Name your home, check its time zone, and set latitude/longitude for sun rules. Set tariff per kWh and currency for energy costs. |
| 2    | **Rooms**                    | Create rooms and choose icons.                                                                                                   |
| 3    | **Devices → Add Device**     | Create controller credentials, connect real or simulated hardware, then name and place its discovered channels.                  |
| 4    | **Devices**                  | Open a device to use its controls, inspect activity/readings, and configure supported settings and schedules.                    |
| 5    | **Scenes**                   | Save a group of actions, then run the scene to check the result on connected devices.                                            |
| 6    | **Automations**              | Choose a trigger, add conditions when needed, select actions, and enable the rule.                                               |
| 7    | **User Access**              | Invite family and assign roles. Owners can change the permissions shared by ordinary members.                                    |
| 8    | **Notifications**            | Review alerts and configure delivery preferences. Enable browser push on each browser you want to receive alerts.                |
| 9    | **Energy**                   | Review consumption once history accumulates. Configure rated watts on devices without a physical meter.                          |
| 10   | **Account / Boards / Admin** | Manage sessions and API keys, maintain boards, or administer the platform when your role allows it.                              |

### Roles and access

| Role               | Scope                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Member**         | Access to the home, with ordinary-member controls restricted by the home's permission settings.                                      |
| **Home admin**     | Manage that home's devices and configuration, subject to owner-only restrictions.                                                    |
| **Owner**          | Highest home role, including member-permission settings and owner-only membership/home operations.                                   |
| **Platform admin** | Access to the separate administration console for platform-wide management and firmware. It does not replace home membership checks. |

### Understanding energy numbers

Without a meter, Voltix estimates energy using on-time, configured rated watts, and a level/brightness factor:

```text
Estimated kWh = rated watts × level factor × on-time in hours ÷ 1000
Estimated cost = kWh × home tariff per kWh
```

The current factor has a 10% floor for powered-on devices. It is a simple model, so fan and dimmer estimates depend on the physical load. Measured energy is used where available; an energy-meter template still requires a real sensor and firmware reporting. These figures are monitoring estimates, not utility billing measurements.

## Connect a real ESP32

### Build and flash

Install PlatformIO, connect the ESP32 by USB, then:

```bash
cd firmware
pio run -e voltix-4l2f
pio run -e voltix-4l2f -t upload
pio device monitor
```

The default environment targets an `esp32dev` board with Arduino and serial output at **115200 baud**. The pin map is in [`firmware/include/board_config.h`](firmware/include/board_config.h).

| Channel | Default function | Relay GPIO |
| ------- | ---------------- | ---------- |
| 1       | Light switch     | 25         |
| 2       | Light switch     | 26         |
| 3       | Light switch     | 27         |
| 4       | Light switch     | 14         |
| 5       | Fan on/off       | 18         |
| 6       | Fan on/off       | 19         |

Relays are active-LOW. GPIO14 may pulse during boot. Fan-speed GPIO32/33 are currently unused, and stock wall-switch inputs are unset. Configure hardware-specific behavior before installation; use the [firmware hardware checklist](docs/firmware.md#hardware-checklist-first-real-board).

### Provision the board

1. Create a board using the app's **Add Device** flow. Save its server, board key, and one-time secret.
2. Power the ESP32 and join its **Voltix-Setup-XXXX** Wi-Fi network.
3. Open the setup portal; if it does not appear automatically, browse to `192.168.4.1`.
4. Select the home Wi-Fi and enter the server, key, and secret.
5. The board saves credentials in NVS, synchronizes time, connects, and exposes its channels to the app.
6. Finish naming devices and assigning rooms in the app.

For production, a hostname such as `voltix.example.com` selects WSS on port 443. For local development, enter **`ws://YOUR_COMPUTER_LAN_IP:4000`** explicitly. An ESP32 cannot reach your computer using `localhost`; the wizard's browser address may need replacing with this LAN endpoint. Allow inbound backend traffic through the development machine's firewall as needed.

Hold **BOOT for five seconds** to erase Wi-Fi and board credentials and reopen setup. Regenerating a board secret disconnects it; enter the new credentials through setup before expecting it to reconnect.

### Extend the firmware

The reusable SDK lives in [`firmware/lib/Voltix`](firmware/lib/Voltix). It handles provisioning, signed connections, relay actions, switch-input polling, state persistence, events, and OTA. Use the app's **Templates** page to generate a starting sketch for a channel layout.

Custom lighting, climate, media, positioning, and sensor hardware need your own drivers and action/event handlers. Generated handler placeholders must be implemented before they represent physical device behavior. Keep the main loop non-blocking and use a distinct model name for each hardware layout so OTA targets the right boards.

## Integrations and API

**REST base:** `/api/v1` · **OpenAPI UI:** `/api/docs` · **Browser socket:** `/api/v1/ws` · **Board socket:** `/api/v1/device`

Create a personal API key in **Account → API keys**. Copy it when shown, select only the required scopes, and optionally set an expiry. It acts with the owner's home access and cannot call arbitrary account or admin routes.

| Scope             | Access                                  |
| ----------------- | --------------------------------------- |
| `homes:read`      | Read permitted homes, rooms, and scenes |
| `devices:read`    | Read devices and history                |
| `devices:control` | Send device actions                     |
| `scenes:run`      | Run a saved scene                       |

Example using Bash and `curl`; replace the URL, token, and device ID:

```bash
export VOLTIX_API='http://localhost:4000/api/v1'
export VOLTIX_KEY='YOUR_API_KEY'
export VOLTIX_DEVICE='YOUR_DEVICE_ID'

curl "$VOLTIX_API/homes" \
  -H "Authorization: Bearer $VOLTIX_KEY"

curl -X POST "$VOLTIX_API/devices/$VOLTIX_DEVICE/actions" \
  -H "Authorization: Bearer $VOLTIX_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"action":"setPowerState","value":{"state":"On"}}'
```

Action names and values depend on the template. A successful action response follows the board's confirmation. Errors use a consistent shape:

```json
{
  "error": {
    "code": "DEVICE_OFFLINE",
    "message": "Hall Light is offline"
  }
}
```

Browser WebSockets use session cookies and home subscriptions. Events include device state/connectivity, device changes, notifications, automation runs, and OTA progress. Integrations use the scoped HTTP API; API keys are not browser-socket credentials. Full routes and event shapes are in [`docs/api.md`](docs/api.md).

## Configuration reference

Use [`backend/.env.example`](backend/.env.example) as the complete backend template. Variables are validated on startup.

| Variable(s)                                                                    | Purpose and setup                                                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL`                                        | Runtime mode, listener, and log verbosity; development API defaults to port 4000.                                                                |
| `APP_ORIGIN`                                                                   | Exact public web origin used for browser-origin checks and email links. Default local value: `http://localhost:3000`.                            |
| `API_ORIGIN`                                                                   | Public API origin used for generated device download URLs. Local default: `http://localhost:4000`; real boards must be able to reach it for OTA. |
| `DATABASE_URL`                                                                 | PostgreSQL connection string. Compose exposes its internal port 5432 on host port 5433.                                                          |
| `JWT_SECRET`                                                                   | At least 32 characters for access-token signing. Generate a private random value.                                                                |
| `SECRET_ENC_KEY`                                                               | Exactly 32 random bytes, base64 encoded, to encrypt board secrets. Keep it stable and back it up separately.                                     |
| `COOKIE_SECURE`                                                                | `false` for local HTTP; must be `true` in production over HTTPS.                                                                                 |
| `TRUST_PROXY`                                                                  | Comma-separated trusted proxy IPs/CIDRs. Restrict it to your actual reverse proxy.                                                               |
| `REQUIRE_EMAIL_VERIFICATION`                                                   | Optional locally; enable for production with working SMTP.                                                                                       |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Account and notification email. Local Mailpit uses port 1025.                                                                                    |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                       | Optional browser push credentials and contact. Generate with `npx web-push generate-vapid-keys`.                                                 |
| `STORAGE_DIR`                                                                  | Firmware image storage; use a durable, backed-up path in production.                                                                             |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                                                | Optional bootstrap platform administrator used by `db:seed`; password must be at least 10 characters.                                            |

Generate **separate values** for these settings, then copy them into the private environment file:

```bash
# JWT_SECRET
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"

# SECRET_ENC_KEY: use base64, exactly 32 decoded bytes
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Frontend options, documented in [`frontend/.env.example`](frontend/.env.example):

| Variable             | Purpose                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_PROXY_TARGET`   | Backend HTTP target for Next.js `/api` rewrites; default `http://localhost:4000`.                                                                 |
| `NEXT_PUBLIC_WS_URL` | Browser-visible realtime socket URL. Development uses `ws://localhost:4000/api/v1/ws`; leave unset in production when app and API share a domain. |

Never put secrets in `NEXT_PUBLIC_*` values. For custom frontend values, use an ignored `frontend/.env.local`; restart the frontend after changing environment settings. Production public values are captured by the Next.js build.

## Security model

| Boundary           | Implemented controls                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User identity      | Argon2id password hashes; 15-minute access JWTs; rotating 30-day refresh tokens; refresh-token reuse detection and session revocation.                    |
| Browser requests   | HttpOnly authentication cookies, SameSite policy, secure cookies in production, and origin checks for state-changing cookie requests.                     |
| Home access        | Membership and role checks on home resources, plus ordinary-member permissions. Non-members receive 404 for protected home lookups.                       |
| Integration access | Hashed API keys, explicit scopes, optional expiry, revocation, and no platform-admin privileges.                                                          |
| Board connection   | Per-board credentials, signed handshake, HMAC-SHA256 message signatures, 60-second freshness window, and replay guards. Use WSS for transport protection. |
| Secret storage     | AES-256-GCM encrypted board secrets; hashed API keys and refresh tokens; encryption key stored outside the database.                                      |
| Input and abuse    | Schema validation, request/frame/upload limits, HTTP rate limiting, event throttling, and invalid-message handling.                                       |
| Operations         | Audit events and log redaction for credentials and sensitive headers.                                                                                     |
| Firmware delivery  | Platform-admin uploads, model/version targeting, short-lived one-time download URLs, size/SHA-256 verification, and conditional rollback support.         |

The firmware trusts the bundled Let's Encrypt roots by default; custom deployments can provide another CA with `Voltix.setRootCA(...)`. The provisioning Wi-Fi is open while the portal runs, so provision in a trusted environment and rotate credentials if exposed. These controls do not constitute a security certification. Operator responsibilities are documented in [`docs/security.md`](docs/security.md).

## Project map

```text
Voltix/
├── backend/
│   ├── src/config/          Environment validation
│   ├── src/db/              Schema, SQL migrations, partitions, admin seed
│   ├── src/lib/             Access checks, crypto, mail, shared errors
│   ├── src/modules/         Domain routes, services, gateway, and jobs
│   └── test/                API, gateway, auth, automation, and OTA tests
├── frontend/
│   ├── public/              Brand assets and push service worker
│   └── src/
│       ├── app/             Auth pages and application pages
│       ├── components/      Controls, charts, forms, layouts, UI components
│       ├── lib/             API client, queries, realtime, types, helpers
│       └── styles/          Global styles and design tokens
├── firmware/
│   ├── include/             Stock board pin map
│   ├── lib/Voltix/          ESP32 SDK, protocol, crypto, CA certificates
│   ├── src/                 Stock controller sketch
│   ├── test/native/         Portable C++ protocol checks
│   └── platformio.ini       ESP32 build configuration
├── packages/protocol/       Shared capabilities, templates, limits, test vectors
├── tools/device-sim/        Virtual board class, interactive CLI, demo home
├── docs/                    Detailed architecture and operator guides
├── docker-compose.yml      Local PostgreSQL and Mailpit
└── package.json             npm workspaces and root commands
```

Backend modules cover authentication, homes, controllers, devices, templates, gateway, realtime, scenes, automations, notifications, telemetry, energy, API keys, OTA, administration, audit, and maintenance.

## Development and verification

Run commands from the repository root unless noted:

| Command                              | Purpose                                                             |
| ------------------------------------ | ------------------------------------------------------------------- |
| `npm ci`                             | Install the lockfile's workspace dependencies                       |
| `npm run dev:db`                     | Start local PostgreSQL and Mailpit                                  |
| `npm run db:migrate`                 | Apply SQL migrations to the configured application database         |
| `npm run db:seed`                    | Bootstrap the configured platform administrator                     |
| `npm run dev:backend`                | Backend watch mode                                                  |
| `npm run dev:frontend`               | Next.js development server                                          |
| `npm run typecheck`                  | Check all workspaces that provide a typecheck script                |
| `npm run lint`                       | Run Biome checks                                                    |
| `npm run format`                     | Apply Biome formatting/fixes; modifies files                        |
| `npm test`                           | Run protocol and backend tests; requires a disposable test database |
| `npm run test -w @voltix/protocol`   | Run shared protocol tests without PostgreSQL                        |
| `npm run test:firmware`              | Compile/run portable C++ protocol tests with g++, clang++, or MSVC  |
| `npm run build`                      | Build backend with tsup and frontend with Next.js                   |
| `npm run demo -w @voltix/device-sim` | Start the demo home using an existing account                       |
| `docker compose stop`                | Stop local service containers while retaining their data            |

### Set up the test database

> **Backend tests reset the `public` schema of their target database. Never point `TEST_DATABASE_URL` at development, staging, or production data.**

With the local Compose services running, create a dedicated empty database once:

```bash
docker compose exec -T postgres createdb -U voltix voltix_test
```

If that database already exists, reuse it only when it contains disposable test data. The default test URL is `postgres://voltix:voltix_dev@localhost:5433/voltix_test`; tests run migrations automatically.

```bash
npm run typecheck
npm run lint
npm test
npm run test:firmware
npm run build
```

For a separate test database, override `TEST_DATABASE_URL` in your shell before `npm test`. Integration tests exercise authentication, home access, device gateway/realtime, automations, API scopes, and OTA using virtual boards. Native C++ checks share signing vectors with TypeScript. Passing them does not validate physical wiring, power behavior, fan-speed electronics, production delivery, or a real firmware rollout.

The simulator package also declares a `load` script, but its `src/load.ts` entry point is absent. Use the demo or CLI commands above; a dedicated load-test runner is not included.

## Deploying Voltix

### What needs to run

- A long-running backend Node.js process, currently **one instance**.
- A Next.js server for the frontend.
- PostgreSQL 16.
- A TLS reverse proxy such as Nginx or Caddy.
- A real SMTP service for production mail; VAPID credentials for browser push.
- Persistent firmware storage and backups.

Use a VPS or container host that supports persistent processes and WebSockets. The included Docker Compose file is a **development database/mail setup**, not a production application deployment.

### Route one public domain

| Public route                      | Destination                          |
| --------------------------------- | ------------------------------------ |
| `https://YOUR_DOMAIN/`            | Next.js on port 3000                 |
| `https://YOUR_DOMAIN/api/...`     | Fastify on port 4000                 |
| `wss://YOUR_DOMAIN/api/v1/device` | Board WebSocket upgrade to Fastify   |
| `wss://YOUR_DOMAIN/api/v1/ws`     | Browser WebSocket upgrade to Fastify |

Configure proxy WebSocket upgrades, an idle timeout of at least 120 seconds, and appropriate forwarded headers. Set `APP_ORIGIN` and `API_ORIGIN` to the public HTTPS origin, `COOKIE_SECURE=true`, a private database URL, generated secrets, SMTP, and the actual trusted proxy address. Enable email verification once mail delivery works.

After configuring the production environment, run from the repository root:

```bash
npm ci
npm run build
npm run db:migrate
npm run db:seed
```

Run these as **separate supervised services** with automatic restart:

```bash
npm run start -w @voltix/backend
npm run start -w @voltix/frontend
```

The backend workspace start command loads `backend/.env`. Use an absolute `STORAGE_DIR` in production to avoid ambiguity across working directories. Keep `.env` private, protect the database from public access, and validate `/api/health`, login, emails, both WebSockets, and a test board after deployment.

### Data, backups, and maintenance

| Data                  | Current retention approach                                                               |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Device events         | Monthly partitions; approximately 90-day retention, with removal at partition boundaries |
| Raw sensor readings   | Daily partitions; approximately 30-day retention                                         |
| Hourly sensor rollups | Retained for two years                                                                   |
| Audit log             | Retained for one year                                                                    |

Background maintenance manages partitions, rollups, retention, and OTA pacing. Backups are an operator responsibility: retain off-server PostgreSQL dumps, firmware images, and private configuration. Back up `SECRET_ENC_KEY` separately; losing it prevents decrypting stored board secrets and requires reprovisioning. Test restoration before relying on backups.

### Firmware releases

1. Implement and test the hardware behavior; set the correct model and increment the firmware version.
2. Build with PlatformIO. The default image is `firmware/.pio/build/voltix-4l2f/firmware.bin`.
3. In **Admin → Firmware**, upload the image with matching model/version metadata.
4. Start with one test home, verify device behavior, then widen the rollout.
5. Monitor progress. The backend paces updates to a maximum of 20 in flight.

The board downloads over HTTPS, verifies size/checksum, writes the inactive OTA slot, and reboots. Automatic rollback depends on bootloader/core rollback support; it is not guaranteed by the stock PlatformIO configuration alone. See [`docs/firmware.md`](docs/firmware.md#ota-updates).

## Troubleshooting

| Symptom                                    | Check                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database connection refused                | Docker engine running; PostgreSQL healthy; `DATABASE_URL` uses host port **5433** for the supplied Compose file.                                                |
| Missing tables                             | Run `npm run db:migrate` against the intended application database.                                                                                             |
| Admin login unavailable                    | Set admin variables before `db:seed`. Rerunning seed ensures admin status but does not overwrite an existing account's password; use password reset if needed.  |
| No real email arrives locally              | Expected with Mailpit. Open port **8025**; configure real SMTP for external delivery.                                                                           |
| REST works but live state does not         | Check`NEXT_PUBLIC_WS_URL`. Next.js development HTTP rewrites do not forward browser WebSockets; use the direct port-4000 socket.                                |
| App requests rejected as cross-site        | `APP_ORIGIN` must match the browser origin exactly, including scheme, hostname, and port. Use `localhost` consistently or configure the LAN origin.             |
| ESP32 never connects locally               | Use the computer's LAN IP and port **4000** with an explicit `ws://` URL; check firewall, Wi-Fi, backend binding, board credentials, and clock synchronization. |
| Board stopped after secret rotation        | Reprovision it with the newly generated credentials. Old credentials are intentionally invalid.                                                                 |
| Push alerts absent                         | Configure VAPID keys, use a supported browser/secure context, grant notification permission, and enable that alert category.                                    |
| Sunrise/sunset rule does not run           | Configure home coordinates and time zone; confirm the rule is enabled and the backend is running.                                                               |
| Energy is zero or approximate              | Set device rated watts, allow usage history to accumulate, and check that a physical meter actually reports readings if measured values are expected.           |
| Backend tests cannot connect               | Create a dedicated `voltix_test` database or set `TEST_DATABASE_URL` to another disposable database.                                                            |
| Relay control works but fan speed does not | Stock firmware only switches fan relays; it stores/reports level without driving speed hardware.                                                                |
| `pio` command missing                      | Install PlatformIO and use its terminal or add it to PATH. Native C++ tests do not compile the ESP32 application.                                               |

## Current boundaries

- **Hardware validation:** run the firmware build and the real-board checklist before installing or releasing. Software tests and simulator success do not prove electrical behavior.
- **Stock controller:** four light relays and two fan on/off relays. Speed electronics/drivers and physical switch-input pins still need a hardware-specific implementation.
- **Extended templates:** RGB lights, thermostats, ACs, media devices, locks, blinds, and sensors require matching hardware and firmware handlers. They are not all implemented by the stock relay sketch.
- **Offline use:** configured local controls and saved power-on behavior can work on the board. App control, notifications, scenes, and backend schedules need server connectivity; no offline web-state cache is provided.
- **Single backend instance:** live sockets and routing use process memory. Multiple replicas require shared event delivery and routing commands to the instance holding each board connection.
- **Push, mail, and OTA:** require their respective infrastructure and permissions. OTA rollback additionally depends on ESP32 core/bootloader configuration.
- **Capacity:** architecture notes discuss intended scale; this README makes no measured capacity or load-test claim.
- **Hosting and recovery:** no production hosting configuration, automated deployment pipeline, or automated backups are included.

## Further documentation

This README covers the complete onboarding path. Use the focused guides and source for implementation details:

| Guide                                | Read for                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md) | Module responsibilities, state flow, persistence, and scaling considerations |
| [Device protocol](docs/protocol.md)  | Handshake, signed envelope, actions, events, timing, and OTA messages        |
| [Firmware](docs/firmware.md)         | SDK usage, provisioning, hardware checklist, TLS, and OTA                    |
| [API](docs/api.md)                   | Routes, key scopes, errors, and realtime event shapes                        |
| [Security](docs/security.md)         | Threat model, controls, and operator responsibilities                        |
| [Operations](docs/operations.md)     | Server setup, updates, monitoring, and backup guidance                       |
| [Design](docs/design.md)             | Web-app design tokens, layouts, and components                               |

---

<div align="center">

**Voltix Home Automation** · [SoVir-Team](https://github.com/SoVir-Team)<br />
From a physical switch to a live dashboard, with one connected system in between.

</div>
