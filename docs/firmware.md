# Firmware

ESP32 firmware for Voltix boards, built with PlatformIO and the Arduino framework.

- [`firmware/lib/Voltix`](../firmware/lib/Voltix): the SDK. It handles Wi-Fi setup, the signed WSS connection,
  relays, wall switches, events, OTA and rollback.
- [`firmware/src/main.cpp`](../firmware/src/main.cpp) and [`include/board_config.h`](../firmware/include/board_config.h):
  the stock Voltix controller (4 lights + 2 fans).

## Status

**Tested:** the protocol and crypto code (SHA-256, HMAC, base64, payload scanner, signing, replay guard).
`npm run test:firmware` compiles it natively and checks it against the shared test vectors. That part is
exactly the code that ships.

**Built:** the whole firmware compiles with PlatformIO (espressif32 6.13, Arduino core 2.0.17) with no warnings
under `-Wall -Wextra`. It uses 17% of RAM and 55% of one OTA slot. A sketch from the Templates page generator
also compiles against the SDK.

**Not yet run on hardware.** Before the first release, go through the hardware checklist below on a real board.

## Build and flash

Install PlatformIO (VS Code extension or `pip install platformio`), then:

```bash
cd firmware
pio run                     # build
pio run -t upload           # flash over USB
pio device monitor          # serial log at 115200
```

Dependencies (resolved by PlatformIO; versions from the last build):
- ArduinoJson 7.4
- links2004/WebSockets 2.7
- tzapu/WiFiManager 2.0.17

The first build downloads about 1 GB of toolchain and framework. On a slow link, pip inside PlatformIO can time
out fetching esptool's dependencies ("No matching distribution found for cryptography"). If that happens,
delete `~/.platformio/packages/tool-esptoolpy` and rerun with `PIP_DEFAULT_TIMEOUT=300 pio run`.

The `min_spiffs` partition table gives two OTA slots, about 1.9 MB each.

## Setting up a board

1. In the web app: **Add device**. Name the board; the app shows the **Server**, **Board key** and
   **Board secret**. The secret is shown once.
2. Power the board. With no credentials it opens the Wi-Fi network **Voltix-Setup-XXXX**.
3. Join it from a phone. The setup page opens; if it doesn't, browse to `192.168.4.1`.
4. Pick the home Wi-Fi and enter the server, key and secret.
   - The server can be a plain host (`voltix.example.com`, which means `wss://…:443`).
   - Or a full URL such as `ws://192.168.1.20:4000` for a development server.
5. The board joins Wi-Fi, gets the time over SNTP, connects, and its channels appear in the app.

**Holding BOOT for 5 seconds** erases Wi-Fi and board credentials and restarts into the setup portal. Do this
when moving a board to a new home, or after regenerating its secret. On later boots, if the saved Wi-Fi is
unreachable, the portal opens for 5 minutes while the board keeps retrying.

Credentials are stored in NVS and are never compiled into the firmware. The setup page never shows the stored
secret; leave the field empty to keep it.

### Bench test against a laptop

For a quick test on the lab network, use this firmware, not a hand-written WebSocket sketch. The server
refuses boards that don't sign their handshake. It also never accepts a key and secret sent inside a
message, because a secret sent like that can be read off the wire.

1. Run the backend on the laptop (`npm run dev`; it listens on all interfaces, port 4000). Allow port 4000 in
   the laptop's firewall.
2. Flash this firmware (`pio run -t upload`) and set the board up as above. For **Server**, enter
   `ws://<laptop LAN IP>:4000`, for example `ws://10.207.68.10:4000`. Never put Wi-Fi passwords or board
   secrets in source code.
3. Relays are active-LOW and wired as in `include/board_config.h`. A relay on GPIO26 is **channel 2**; it
   shows up in the app as "Switch 2". Toggle it there and watch `pio device monitor`.

## Writing a board sketch

The **Templates** page generates a sketch for any channel layout. The shape is:

```cpp
#include <Arduino.h>
#include <Voltix.h>

bool onAction(VoltixChannel &ch, const char *action, JsonObjectConst value, JsonObject response) {
  switch (ch.number) {
    case 3:  // dimmable light: drive your PWM here
      if (!strcmp(action, "setBrightness")) {
        int b = value["brightness"];
        ledcWrite(0, b * 255 / 100);
        response["brightness"] = b;
        return true;
      }
  }
  return false;  // the SDK answers "not supported"
}

void setup() {
  Serial.begin(115200);
  Voltix.setRelayActiveLow(true);                 // before addChannel; true is the default
  Voltix.addChannel(1, "switch", 25);             // relay on GPIO25
  Voltix.addSwitchInput(1, 13, VOLTIX_LATCHING);  // wall switch on GPIO13 (to GND)
  Voltix.addChannel(2, "fan", 18);
  Voltix.addChannel(3, "dimSwitch", VOLTIX_NO_PIN);
  Voltix.addChannel(4, "temperatureSensor");
  Voltix.onAction(onAction);
  Voltix.begin("my-board", "1.0.0");              // model, version
}

void loop() {
  Voltix.loop();
  static uint32_t last;
  if (millis() - last > 30000) {
    last = millis();
    Voltix.sendTemperature(4, 24.5, 55);
  }
}
```

**How actions are handled:**

1. `setPowerState` on a channel with a relay pin: the SDK switches the relay.
2. Everything else goes to `onAction` first. Return `true` and fill `response` with the resulting value. The SDK
   remembers `state` and `powerLevel` from the response.
3. If there is no handler, or it returns `false`: the SDK stores `setPowerLevel` / `adjustPowerLevel` itself.
   Any other action is answered "not supported".

**Local control and events:**

- `setPowerState(ch, on, physical)` and `setPowerLevel(…)` change the state locally and report it.
- `sendTemperature`, `sendMotion`, `sendContact`, `sendDoorbellPress`, `sendPowerUsage`, `sendAirQuality` and
  `sendEvent` send sensor events. They return `false` when the event was not sent (offline or rate limited).

**Rules:**

- Keep `loop()` non-blocking.
- Wall switches are polled in their own task, so they keep working while the network is down or a connection
  attempt is in progress.
- Changes made offline are reported once the board reconnects.
- Use a different `model` name for each hardware layout. OTA releases are matched by model.

## Power-on behaviour

Set per device in the app: **Off**, **Last state** (default) or **Cloud**. The board stores the choice and each
channel's state in NVS. It writes 2 s after the last change, and only when something changed, to spare the
flash. It applies them at boot before Wi-Fi is up, so lights come back even without internet. With **Cloud**,
the server then restores the state it last knew.

## Local control (no internet)

Each board serves its own small page on the home Wi-Fi, so lights and fans can be switched when the internet
or the Voltix server is down.

- **Turn it on:** Home settings → **Control without internet** → set a 6–8 digit home PIN. Local control is
  off until a PIN is set, and turning it off disables every board's page at once.
- **Address:** `http://voltix-xxxx.local` (last 4 hex digits of the MAC) and `http://<board IP>`. Both are
  shown on the Boards page. Many Android phones can't open `.local` names, so use the number there. Give the
  board a fixed DHCP lease in the router so the number doesn't change.
- **Use:** enter the PIN once per board and phone. The page shows each relay channel by its app name, with an
  on/off button, and a level slider for fans and dimmers. It refreshes every 2 s and links to the other Voltix
  boards it finds on the network (mDNS `_voltix._tcp`).
- **Back online:** changes made on the page reach the cloud when it is reachable again. Activity shows them as
  "on the local page".

How it works ([`VoltixLocal.cpp`](../firmware/lib/Voltix/src/VoltixLocal.cpp)):
- The cloud never sends the PIN. The `config` message carries `localPinHash` = HMAC(board secret,
  `"local-pin:" + PIN`). The board keeps it in NVS (`lp`), with channel names (`n1`, `n2`, …), so both survive
  a reboot without internet.
- Login recomputes the hash from the typed PIN and compares in constant time. Five wrong PINs lock logins for
  5 minutes. A session is a random 128-bit cookie (`vx_local`, HttpOnly, SameSite=Strict) kept in RAM, up to 8
  of them. They are lost on reboot, and a PIN change signs everyone out.
- The page answers only to its own IP or `.local` name, and POSTs need its own `Origin`. This blocks other
  websites (and DNS rebinding) from driving the board through a phone's browser.
- The page and mDNS start once Wi-Fi is up and the setup portal is closed, since both use port 80. Nothing on
  the page needs internet time.
- Commands from the page go through the same code as cloud commands, so `onAction` handlers work for them.
  Channels with neither a relay nor a level are not shown.

## OTA updates

1. A platform admin uploads a `.bin` under **Admin → Firmware**. Model and version must match what the image
   reports.
2. The admin starts a rollout. Boards update 20 at a time.
3. Each board:
   - downloads the image over HTTPS using the same CA as the WebSocket;
   - checks the size and SHA-256 while writing the inactive slot;
   - reports progress;
   - reboots.
4. The new image counts as good once it reaches the cloud. If it can't connect within 10 minutes, the bootloader
   rolls back to the previous image. This needs app rollback enabled in the core's sdkconfig, which the SDK
   detects; without it, updates still work but don't roll back.

Release checklist:
1. Bump `VOLTIX_FIRMWARE_VERSION` in `platformio.ini`.
2. `pio run`.
3. Upload `.pio/build/voltix-4l2f/firmware.bin`.
4. Roll out to one test home before everyone.

## TLS

The board trusts Let's Encrypt's roots (ISRG Root X1 and X2) by default
([`VoltixRootCA.h`](../firmware/lib/Voltix/src/VoltixRootCA.h)). That covers Hostinger's free SSL. For another
CA, call `Voltix.setRootCA(pem)` before `begin()`. `ws://` (no TLS) is accepted for development only.

## Stock board pin map

| Channel | Device       | GPIO           | Notes                                            |
| ------- | ------------ | -------------- | ------------------------------------------------ |
| 1–4     | Light switch | 25, 26, 27, 14 | relays active-LOW; GPIO14 may click once at boot |
| 5–6     | Fan          | 18, 19         | on/off relay; speed stored, not driven yet       |
| –       | Fan speed    | 32, 33         | unused until the speed hardware is chosen        |
| –       | BOOT button  | 0              | hold 5 s to reset credentials                    |

The current PCB has no wall-switch inputs. Add them in `board_config.h`. Use pins with internal pull-ups; GPIO
34–39 have none.

## Hardware checklist (first real board)

- [ ] `pio run` builds without warnings; image < 1.9 MB.
- [ ] Fresh board opens Voltix-Setup-XXXX; portal saves Wi-Fi + server + key + secret.
- [ ] Board appears online; 6 devices created; names/rooms editable.
- [ ] App toggles each relay within ~300 ms; the relay polarity is right and nothing clicks at boot except GPIO14.
- [ ] Power-cut test for each power-on behaviour (off / last / cloud).
- [ ] Unplug the router: relays and wall switches still work; changes reach the app after reconnect.
- [ ] Local control:
  1. Set a home PIN.
  2. Unplug the router's internet (keep the router on).
  3. On a phone on the home Wi-Fi, open the board's IP from the Boards page, enter the PIN, and toggle channel
     2 (GPIO26).
  4. Five wrong PINs lock logins for 5 minutes.
  5. Restore internet: within a minute, Activity shows the change "on the local page".
  6. Turn the PIN off: the page says local control is off.
- [ ] Regenerate the secret in the app: board goes offline, comes back after re-entering it in the portal.
- [ ] Hold BOOT 5 s: credentials wiped, portal reopens.
- [ ] OTA from the admin page: progress shows, board reports the new version.
- [ ] OTA with a corrupted image (wrong checksum): board reports `failed`, keeps running the old one.
- [ ] 24 h soak: no reboots (`esp_reset_reason` in the log), heap stable.
