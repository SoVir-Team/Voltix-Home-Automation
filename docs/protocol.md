# Device protocol

How a Voltix board talks to the cloud. The reference implementations are
[`packages/protocol`](../packages/protocol) (server side), [`firmware/lib/Voltix`](../firmware/lib/Voltix) (ESP32)
and [`tools/device-sim`](../tools/device-sim) (virtual boards). All three are tested against the same
[`test-vectors.json`](../packages/protocol/test-vectors.json).

Numbers below come from [`limits.ts`](../packages/protocol/src/limits.ts), mirrored in
[`VoltixLimits.h`](../firmware/lib/Voltix/src/VoltixLimits.h).

## Terms

- **Board / controller**: one ESP32. It has one key (`vxc_…`) and one secret, and keeps one WebSocket open.
- **Channel**: a numbered output or input on a board (1–32). Each channel becomes one **device** in the app
  (a light, a fan, a sensor…).
- **Device id**: the cloud's UUID for a channel. The board learns these from the `config` message.

## 1. Connecting

The board opens `wss://<server>/api/v1/device` with these headers:

| Header              | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `x-voltix-key`      | board key, e.g. `vxc_80db…`                                                      |
| `x-voltix-ts`       | current Unix time in seconds                                                     |
| `x-voltix-sig`      | base64 HMAC-SHA256(secret, `"<key>\n<ts>"`)                                      |
| `x-voltix-channels` | `channel:type` list, e.g. `1:switch,2:switch,5:fan` (type = device template key) |
| `x-voltix-model`    | firmware model, e.g. `voltix-4l2f` (OTA releases target a model)                 |
| `x-voltix-version`  | firmware version, e.g. `1.0.0`                                                   |
| `x-voltix-mac`      | Wi-Fi MAC address                                                                |
| `x-voltix-restore`  | `true` on the first connection after power-up, else `false`                      |

The server rejects the upgrade before any WebSocket traffic:

- **401** for an unknown key, a bad signature, or a `ts` more than 60 s from server time. So the board must have
  real time (SNTP) **before** it connects.
- **400 `BAD_CHANNELS`** for a malformed channel list. Each entry must match
  `^\d{1,2}:[a-zA-Z][a-zA-Z0-9_-]{0,31}$`, numbers must be unique, and there can be at most 32 channels.

A second connection with the same key replaces the first; the old socket is closed with code **4001**. When a
user regenerates the secret, the live socket is closed with **4002** and the next handshake fails with 401
until the board gets the new secret.

## 2. After the handshake

1. The server sends an **unsigned** clock sync: `{"timestamp":1767225600}`. The board may use it to correct
   drift.
2. Any channel the cloud hasn't seen before becomes a new, unnamed device.
3. The server sends a signed **`config`** request. Its `deviceId` is the board key, and its value is:

   ```json
   { "channels": [ { "channel": 1, "deviceId": "6f1c…", "type": "switch", "powerOnBehavior": "last" } ] }
   ```

   `powerOnBehavior` is one of:
   - `off`: start off;
   - `last`: start in the last local state;
   - `cloud`: start in the last local state, then take the cloud's state.
4. If `x-voltix-restore` was `true`, the server sends `setPowerState` / `setPowerLevel` / `setBrightness`
   requests (clientId `restore`) for channels whose behaviour is `cloud`.
5. If an OTA release is waiting for this board, the server sends `otaUpdateAvailable` (see §6).

**Liveness:**
- The server pings every 30 s; two missed pongs close the socket.
- A board is shown offline only after a 10 s grace period.
- Owners are notified if it stays offline for 5 minutes.

**Reconnects:** boards retry with jittered backoff between 1 s and 60 s. The SDK waits a random 1–10 s after a
drop, so a server restart isn't hit by every board at once.

## 3. Message envelope

Every message except the clock sync is one JSON text frame of at most 8 KB:

```json
{
  "header": { "payloadVersion": 2, "signatureVersion": 1 },
  "payload": {
    "action": "setPowerState",
    "clientId": "app",
    "createdAt": 1767225600,
    "deviceId": "6f1c…",
    "replyToken": "a1b2c3…",
    "type": "request",
    "value": { "state": "On" }
  },
  "signature": { "HMAC": "2lofmW5JOJkl1IITF5c3LI5hFuIyM8BPVTfaQpaFXYY=" }
}
```

| Field                | Meaning                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `action`             | what to do or what happened (≤ 64 chars)                                                                                    |
| `clientId`           | who caused it: `app`, `api`, `scene`, `schedule`, `automation`, `restore`, `system`; from the board: `physical` or `device` |
| `createdAt`          | Unix seconds when the message was created                                                                                   |
| `deviceId`           | device UUID, or the board key for board-level actions                                                                       |
| `replyToken`         | unique per message; responses echo the request's token                                                                      |
| `type`               | `request` (cloud → board), `response` (board → cloud), `event` (board → cloud)                                              |
| `value`              | object; shape depends on the action                                                                                         |
| `success`, `message` | responses only                                                                                                              |
| `cause`              | events from a wall switch: `{"type":"PHYSICAL_INTERACTION"}`                                                                |

### Signing

`signature.HMAC` = base64 HMAC-SHA256(board secret, **the exact bytes of the `payload` object as they appear
in the frame**).

The receiver locates those bytes with a small scanner and hashes them as they are. It never re-serialises the
JSON, because key order and number formatting differ between Node and the ESP32. The scanner:
- skips whitespace;
- walks the top-level members;
- skips strings (honouring `\` escapes) and nested objects/arrays by depth;
- returns the span of the `payload` value.

See [`raw-payload.ts`](../packages/protocol/src/raw-payload.ts) and
[`VoltixProtocol.cpp`](../firmware/lib/Voltix/src/VoltixProtocol.cpp).

### Checks on every received message (both sides)

1. Signature valid. The comparison is constant-time.
2. `header.payloadVersion == 2`.
3. `|now − createdAt| ≤ 60 s`.
4. `type:replyToken` not seen before within the window (replay guard).
5. Payload shape valid. The server checks it with zod; the board checks the fields it uses.

The server closes a socket after 10 invalid messages (code **4003**). The board drops its own connection
after 10.

## 4. Commands (cloud → board → cloud)

The cloud sends a `request`. The board applies it and answers with a `response` that echoes `action`,
`clientId`, `deviceId` and `replyToken`. The response carries:
- `success` and a short `message`;
- `value` = the **resulting** state (for example, `adjustPowerLevel {powerLevelDelta: 10}` answers with
  `{powerLevel: 60}`).

The cloud waits 8 s. The API returns **504 `DEVICE_TIMEOUT`** if no answer arrives, and **409
`DEVICE_OFFLINE`** if the board isn't connected.

| Capability       | Request action(s) and value                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| powerState       | `setPowerState {state: "On" \| "Off"}`                                                              |
| powerLevel       | `setPowerLevel {powerLevel: 0–100}`, `adjustPowerLevel {powerLevelDelta}`                           |
| brightness       | `setBrightness {brightness: 0–100}`, `adjustBrightness {brightnessDelta}`                           |
| color            | `setColor {color: {r, g, b}}`                                                                       |
| colorTemperature | `setColorTemperature {colorTemperature}`                                                            |
| rangeValue       | `setRangeValue {rangeValue}` (blinds, garage)                                                       |
| thermostat       | `setThermostatMode {thermostatMode}`, `targetTemperature {temperature}`                             |
| lock             | `setLockState {state: "lock" \| "unlock"}` → response `{state: "LOCKED" \| "UNLOCKED" \| "JAMMED"}` |
| mode             | `setMode {mode}`                                                                                    |
| media            | `setVolume`, `setMute`, `mediaControl`, `selectInput`, `changeChannel`, `skipChannels`              |

The full list, with value ranges, is the capability registry in
[`capabilities.ts`](../packages/protocol/src/capabilities.ts).

## 5. Events (board → cloud)

| Event                | Value                                                      | clientId              |
| -------------------- | ---------------------------------------------------------- | --------------------- |
| `setPowerState`      | `{state: "On" \| "Off"}` (+ `cause` if from a wall switch) | `physical` / `device` |
| `setPowerLevel`      | `{powerLevel}`                                             | `physical` / `device` |
| `currentTemperature` | `{temperature, humidity?}`                                 | `device`              |
| `motion`             | `{state: "detected" \| "notDetected"}`                     | `device`              |
| `setContactState`    | `{state: "open" \| "closed"}`                              | `device`              |
| `DoorbellPress`      | `{state: "pressed"}`                                       | `physical`            |
| `airQuality`         | `{pm1, pm2_5, pm10}`                                       | `device`              |
| `powerUsage`         | `{power, voltage?, current?, wattHours?}`                  | `device`              |

**Rate limits**, per device:
- token bucket, burst 10, refilling 1 per second;
- telemetry (temperature, air quality, power) at most once per 10 s.

The SDK applies the same limits locally and queues the latest state rather than dropping it.

## 6. Board-level actions

These use `deviceId` = board key.

| Action               | Direction | Value                                                                                                        |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `config`             | → board   | see §2                                                                                                       |
| `restart`            | → board   | `{}`                                                                                                         |
| `otaUpdateAvailable` | → board   | `{url, version, size, sha256 (64 hex), forceUpdate}`                                                         |
| `otaStatus`          | → cloud   | `{version, status, progress?, error?}`, status ∈ `accepted rejected downloading verifying installing failed` |

**OTA flow:**
1. The board downloads `url` (`/api/v1/ota/download/<token>`; one-time, valid for 15 minutes).
2. It checks the size and the SHA-256, writes the inactive OTA slot, reports progress, and reboots.
3. The server marks the update successful when the board reconnects reporting the new version. It marks it
   failed after 15 minutes.
4. The SDK keeps the new image "pending verify" until it reaches the cloud, and rolls back if it doesn't
   within 10 minutes.

## Changing the protocol

1. Change `packages/protocol`.
2. Regenerate the vectors with `npx tsx packages/protocol/scripts/make-vectors.ts`.
3. Update the firmware.
4. Run `npm test` and `npm run test:firmware`.

Bump `payloadVersion` for changes old firmware can't understand.
