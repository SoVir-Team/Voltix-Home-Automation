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

**Not yet built here:** the ESP32-specific part (`Voltix.cpp`). This machine has no ESP32 toolchain. Before the
first release:
1. Run `pio run` once.
2. Go through the hardware checklist below on a real board.

## Build and flash

Install PlatformIO (VS Code extension or `pip install platformio`), then:

```bash
cd firmware
pio run                     # build
pio run -t upload           # flash over USB
pio device monitor          # serial log at 115200
```

Dependencies (resolved by PlatformIO):
- ArduinoJson 7
- links2004/WebSockets 2.6
- tzapu/WiFiManager 2.0

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
- [ ] Regenerate the secret in the app: board goes offline, comes back after re-entering it in the portal.
- [ ] Hold BOOT 5 s: credentials wiped, portal reopens.
- [ ] OTA from the admin page: progress shows, board reports the new version.
- [ ] OTA with a corrupted image (wrong checksum): board reports `failed`, keeps running the old one.
- [ ] 24 h soak: no reboots (`esp_reset_reason` in the log), heap stable.
