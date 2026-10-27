// Voltix controller firmware. Credentials come from the setup portal (Wi-Fi "Voltix-Setup-XXXX"), never
// from code; hold BOOT for 5 s to wipe them. The pin map lives in include/board_config.h.
#include <Arduino.h>
#include <Voltix.h>

#include "board_config.h"

#ifndef VOLTIX_MODEL
#define VOLTIX_MODEL "voltix-4l2f"
#endif
#ifndef VOLTIX_FIRMWARE_VERSION
#define VOLTIX_FIRMWARE_VERSION "0.0.0-dev"
#endif

void setup() {
  Serial.begin(115200);
  Voltix.setRelayActiveLow(RELAY_ACTIVE_LOW);  // before addChannel, so relays start in the off position
  for (const BoardChannel &c : kBoardChannels) {
    Voltix.addChannel(c.channel, c.type, c.relayPin);
    if (c.switchPin != VOLTIX_NO_PIN) Voltix.addSwitchInput(c.channel, c.switchPin, c.switchMode);
  }
  Voltix.begin(VOLTIX_MODEL, VOLTIX_FIRMWARE_VERSION);
}

void loop() {
  Voltix.loop();
}
