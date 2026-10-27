# Voltix Home Automation

Voltix connects ESP32-based smart switches, fans, lights and sensors to a secure cloud and a web app.
Homeowners control every device from any phone or computer, group them into rooms and scenes, schedule
and automate them, track energy use, and share access with family. The firmware keeps physical
switches, the app and automations in sync.

| Part                        | Path                 | Stack                                                       |
| --------------------------- | -------------------- | ----------------------------------------------------------- |
| Web app (PWA, mobile-first) | `frontend/`          | Next.js, TypeScript, Tailwind CSS, TanStack Query           |
| API + device gateway        | `backend/`           | Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL       |
| Device protocol (shared)    | `packages/protocol/` | TypeScript + zod; signing test vectors shared with firmware |
| Firmware                    | `firmware/`          | ESP32, Arduino framework, PlatformIO                        |
| Device simulator            | `tools/device-sim/`  | Virtual boards for development, tests and load tests        |

Architecture, protocol, security and operations docs live in [`docs/`](docs/).

## Quick start (development)

Requirements: Node.js 22.12+ (24 recommended), Docker Desktop (for the dev database).

```bash
npm install
npm run dev:db            # PostgreSQL on :5433 + Mailpit (mail UI on http://localhost:8025)
cp backend/.env.example backend/.env
npm run db:migrate
npm run db:seed
npm run dev:backend       # API on http://localhost:4000 (docs at /docs)
npm run dev:frontend      # Web app on http://localhost:3000
```

Checks: `npm run typecheck && npm run lint && npm test`. Firmware protocol tests: `npm run test:firmware`
(needs g++, clang++ or Visual Studio Build Tools).

### Try it without hardware

Register an account in the web app, then fill it with a demo home: four simulated boards with lights, fans and
sensors that stay online and answer commands.

```bash
DEMO_EMAIL=you@example.com DEMO_PASSWORD='your-password' npm run demo -w @voltix/device-sim
```

To test the Add-device flow, copy the key and secret the wizard shows and run one virtual board:

```bash
npx tsx tools/device-sim/src/cli.ts --key vxc_… --secret … --channels 1:switch,2:switch,5:fan
```

### Real boards

Build and flash `firmware/` with PlatformIO, then set the board up through its "Voltix-Setup-XXXX" Wi-Fi.
See [docs/firmware.md](docs/firmware.md).

## Documentation

| Doc                                     | For                                                       |
| --------------------------------------- | --------------------------------------------------------- |
| [architecture.md](docs/architecture.md) | How the parts fit together; main flows; data retention    |
| [protocol.md](docs/protocol.md)         | Board ↔ cloud protocol: handshake, signing, messages, OTA |
| [firmware.md](docs/firmware.md)         | Building, provisioning, the SDK, OTA, hardware checklist  |
| [api.md](docs/api.md)                   | REST API, API keys and scopes, live updates               |
| [security.md](docs/security.md)         | Threats, controls, operator responsibilities              |
| [operations.md](docs/operations.md)     | Production setup (VPS), configuration, updates, backups   |
| [design.md](docs/design.md)             | Design tokens, layout and components of the web app       |

## How it works (one paragraph)

Each ESP32 board ("controller") gets a key and secret from the web app and opens a secure WebSocket to
the backend. Every message is signed with HMAC-SHA256 and rejected if older than 60 seconds. A tap in the app
becomes a signed command to the board; the board switches the relay and answers with the new state, which is
stored and pushed live to every open app. Flipping a wall switch sends a state event the same way, so app,
schedules and physical switches never drift apart.
