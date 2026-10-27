// Voltix ESP32 SDK: connects a board to the Voltix cloud over signed WSS.
//
//   Voltix.addChannel(1, "switch", 25);                 // channel 1 drives the relay on GPIO25
//   Voltix.addSwitchInput(1, 13, VOLTIX_MOMENTARY);      // optional wall switch, works offline too
//   Voltix.onAction(onAction);                           // optional: actions a plain relay can't do
//   Voltix.begin("voltix-esp32", "1.0.0");
//   ...
//   Voltix.loop();                                       // call every loop(), never block for long
//
// Wi-Fi, server address and board credentials are entered in the setup portal ("Voltix-Setup-XXXX"),
// stored in NVS and never compiled in. Hold BOOT for 5 s to wipe them and reopen the portal.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "VoltixLimits.h"

#define VOLTIX_NO_PIN 255

enum VoltixSwitchMode : uint8_t {
  VOLTIX_MOMENTARY,  // push button: each press toggles
  VOLTIX_LATCHING,   // ordinary wall switch: every flip toggles
};

enum VoltixPowerOn : uint8_t { VOLTIX_POWER_ON_OFF, VOLTIX_POWER_ON_LAST, VOLTIX_POWER_ON_CLOUD };

struct VoltixChannel {
  uint8_t number = 0;
  char type[33] = "";
  char deviceId[65] = "";  // assigned by the cloud; empty until the first config message
  uint8_t relayPin = VOLTIX_NO_PIN;
  bool on = false;
  int8_t level = -1;  // powerLevel 0..100, -1 = never set
  uint8_t powerOn = VOLTIX_POWER_ON_LAST;

  // Wall switch input.
  uint8_t switchPin = VOLTIX_NO_PIN;
  uint8_t switchMode = VOLTIX_MOMENTARY;
  bool switchStable = true;
  bool switchRaw = true;
  uint32_t switchChangedAt = 0;

  // Event rate limiting (mirrors the server's token bucket, so events are coalesced rather than dropped).
  float tokens = VOLTIX_EVENT_BURST;
  uint32_t tokensAt = 0;
  uint32_t telemetryAt = 0;
  uint8_t reportPending = 0;  // local changes that still have to reach the cloud (see Voltix.cpp)
};

// Handles actions the SDK can't do with a plain relay (brightness, colour, thermostat, locks, ...), and every
// action for channels without a relay pin. Apply the change, put the resulting value in `response` and return
// true; return false to report the action as unsupported.
typedef bool (*VoltixActionHandler)(VoltixChannel &ch, const char *action, JsonObjectConst value,
                                    JsonObject response);

class VoltixClass {
 public:
  void addChannel(uint8_t number, const char *type, uint8_t relayPin = VOLTIX_NO_PIN);
  void addSwitchInput(uint8_t channel, uint8_t pin, VoltixSwitchMode mode = VOLTIX_MOMENTARY);
  void onAction(VoltixActionHandler handler) { handler_ = handler; }
  // Most relay modules (and the Voltix board) switch on LOW. Call with false for active-HIGH relays.
  void setRelayActiveLow(bool activeLow) { activeLow_ = activeLow; }
  // PEM root certificate(s) for wss:// and OTA downloads. Default: Let's Encrypt roots.
  void setRootCA(const char *pem) { rootCa_ = pem; }
  // Pin of the button that wipes credentials when held for 5 s (default GPIO0, the BOOT button).
  void setResetButton(uint8_t pin) { resetPin_ = pin; }

  void begin(const char *model, const char *version);
  void loop();

  // Local control: drives the relay, remembers the state and reports it to the cloud.
  bool setPowerState(uint8_t channel, bool on, bool physical = false);
  bool setPowerLevel(uint8_t channel, int level, bool physical = false);

  // Events for sensors and other inputs. Return false if not sent (offline, unknown channel, rate limited).
  bool sendEvent(uint8_t channel, const char *action, JsonObjectConst value, bool physical = false);
  bool sendTemperature(uint8_t channel, float celsius, float humidity = NAN);
  bool sendMotion(uint8_t channel, bool detected);
  bool sendContact(uint8_t channel, bool open);
  bool sendDoorbellPress(uint8_t channel);
  bool sendPowerUsage(uint8_t channel, float watts, float volts = NAN, float amps = NAN);
  bool sendAirQuality(uint8_t channel, float pm1, float pm2_5, float pm10);

  bool connected() const { return online_; }
  VoltixChannel *channel(uint8_t number);
  // Erases Wi-Fi and board credentials, then restarts into the setup portal.
  void factoryReset();

 private:
  friend struct VoltixInternals;

  VoltixChannel channels_[VOLTIX_MAX_CHANNELS];
  uint8_t channelCount_ = 0;
  VoltixActionHandler handler_ = nullptr;
  bool activeLow_ = true;
  const char *rootCa_ = nullptr;
  uint8_t resetPin_ = 0;
  const char *model_ = "voltix-esp32";
  const char *version_ = "0.0.0";
  bool online_ = false;
};

extern VoltixClass Voltix;
