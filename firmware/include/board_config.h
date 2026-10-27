// Pin map of the stock Voltix controller (4 lights + 2 fans), carried over from the earlier LAN firmware.
// Change this file, not main.cpp, for a different board layout.
#pragma once

#include <Voltix.h>

// Relay modules on this board switch on LOW.
#define RELAY_ACTIVE_LOW true

struct BoardChannel {
  uint8_t channel;
  const char *type;  // a Voltix device type (see the Templates page)
  uint8_t relayPin;
  uint8_t switchPin;  // wall switch input, or VOLTIX_NO_PIN
  VoltixSwitchMode switchMode;
};

// Note: GPIO14 briefly outputs a signal during boot, so the channel 4 relay may click at power-on.
// Fan speed pins (GPIO32/33) are left unused: speed is stored and reported but not driven until the speed
// hardware (stepped capacitor, triac or 0-10 V) is decided. Drive it from an onAction handler then.
// Wall switches: no input pins on the current PCB. Add them here, e.g. {1, "switch", 25, 13, VOLTIX_LATCHING}.
static const BoardChannel kBoardChannels[] = {
    {1, "switch", 25, VOLTIX_NO_PIN, VOLTIX_LATCHING},
    {2, "switch", 26, VOLTIX_NO_PIN, VOLTIX_LATCHING},
    {3, "switch", 27, VOLTIX_NO_PIN, VOLTIX_LATCHING},
    {4, "switch", 14, VOLTIX_NO_PIN, VOLTIX_LATCHING},
    {5, "fan", 18, VOLTIX_NO_PIN, VOLTIX_LATCHING},
    {6, "fan", 19, VOLTIX_NO_PIN, VOLTIX_LATCHING},
};
