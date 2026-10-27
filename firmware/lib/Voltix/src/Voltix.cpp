#include "Voltix.h"

#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <esp_ota_ops.h>
#include <time.h>

#include <memory>
#include <string>

#include "VoltixCrypto.h"
#include "VoltixProtocol.h"
#include "VoltixRootCA.h"

#define VLOG(fmt, ...) Serial.printf("[voltix] " fmt "\n", ##__VA_ARGS__)

#if defined(CONFIG_APP_ROLLBACK_ENABLE) || defined(CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE)
#define VOLTIX_ROLLBACK 1
// Keep a freshly installed image in "pending verify" until it has reached the cloud (see markFirmwareValid).
extern "C" bool verifyRollbackLater() { return true; }
#endif

VoltixClass Voltix;

namespace {

const char *kDevicePath = "/api/v1/device";
const uint32_t kDebounceMs = 50;
const uint32_t kResetHoldMs = 5000;
const uint32_t kStateSaveDelayMs = 2000;
const uint32_t kPortalTimeoutS = 300;
const uint32_t kWifiRetryMs = 30000;
// A new firmware that can't reach the cloud for this long after an OTA is rolled back.
const uint32_t kRollbackAfterMs = 10UL * 60 * 1000;
const uint32_t kMinEpoch = 1700000000;
const uint8_t kMaxInvalid = 10;

// reportPending bits.
const uint8_t kReportPower = 1;
const uint8_t kReportLevel = 2;
const uint8_t kReportPhysical = 0x80;
// The input task and loop() both update reportPending.
portMUX_TYPE reportMux = portMUX_INITIALIZER_UNLOCKED;

void queueReport(VoltixChannel &c, uint8_t bits) {
  portENTER_CRITICAL(&reportMux);
  c.reportPending |= bits;
  portEXIT_CRITICAL(&reportMux);
}

void clearReport(VoltixChannel &c, uint8_t bits) {
  portENTER_CRITICAL(&reportMux);
  c.reportPending &= ~bits;
  if (!(c.reportPending & (kReportPower | kReportLevel))) c.reportPending = 0;
  portEXIT_CRITICAL(&reportMux);
}

}  // namespace

struct VoltixInternals {
  // Settings from the setup portal (NVS namespace "voltix").
  Preferences prefs;
  String server, key, secret;
  String host;
  uint16_t port = 443;
  bool tls = true;
  String channelsHeader;

  // Cloud connection.
  WebSocketsClient ws;
  bool wsStarted = false;
  bool restoreOnConnect = true;  // only the first connection after boot asks the cloud to restore states
  uint32_t holdUntil = 0;
  uint32_t outageStart = 0;
  float jitter = 1;
  uint32_t headersAt = 0;
  uint8_t invalid = 0;
  bool dropSocket = false;  // set inside the socket callback, acted on after ws.loop() returns
  voltix::ReplayGuard replay;
  uint32_t syncedEpoch = 0;
  uint32_t syncedAtMs = 0;

  // Setup portal.
  WiFiManager wm;
  WiFiManagerParameter pServer{"server", "Server", "", 96};
  WiFiManagerParameter pKey{"key", "Board key", "", 64};
  WiFiManagerParameter pSecret{"secret", "Board secret (leave empty to keep)", "", 96,
                               "type='password' autocomplete='off'"};
  String apName;
  uint32_t wifiKickAt = 0;

  // Persistence and housekeeping.
  uint8_t savedState[VOLTIX_MAX_CHANNELS];
  volatile uint32_t stateDirtyAt = 0;
  volatile uint32_t resetPressedAt = 0;
  uint32_t restartAt = 0;
  bool validated = false;

  // OTA offer waiting to run from loop() (never inside the WebSocket callback).
  bool otaPending = false;
  bool otaRunning = false;
  String otaUrl, otaVersion, otaSha;
  uint32_t otaSize = 0;

  // ---------------------------------------------------------------------------------------------------------

  static VoltixInternals &get() {
    static VoltixInternals vx;
    return vx;
  }

  static VoltixClass &v() { return Voltix; }

  bool haveCreds() const { return server.length() && key.length() && secret.length(); }

  uint32_t now() const {
    if (syncedEpoch) return syncedEpoch + (millis() - syncedAtMs) / 1000;
    time_t t = time(nullptr);
    return t > (time_t)kMinEpoch ? (uint32_t)t : 0;
  }

  static void writeRelay(const VoltixChannel &c) {
    if (c.relayPin == VOLTIX_NO_PIN) return;
    digitalWrite(c.relayPin, c.on != v().activeLow_ ? HIGH : LOW);
  }

  void markDirty() { stateDirtyAt = millis() | 1; }

  VoltixChannel *byDeviceId(const char *id) {
    for (uint8_t i = 0; i < v().channelCount_; i++) {
      if (v().channels_[i].deviceId[0] && strcmp(v().channels_[i].deviceId, id) == 0) return &v().channels_[i];
    }
    return nullptr;
  }

  // --- settings ----------------------------------------------------------------------------------------------

  void parseServer() {
    String s = server;
    s.trim();
    tls = true;
    port = 443;
    if (s.startsWith("wss://") || s.startsWith("https://")) {
      s = s.substring(s.indexOf("//") + 2);
    } else if (s.startsWith("ws://") || s.startsWith("http://")) {
      s = s.substring(s.indexOf("//") + 2);
      tls = false;
      port = 80;
    }
    int slash = s.indexOf('/');
    if (slash >= 0) s = s.substring(0, slash);
    int colon = s.lastIndexOf(':');
    if (colon > 0) {
      port = (uint16_t)s.substring(colon + 1).toInt();
      s = s.substring(0, colon);
    }
    host = s;
  }

  void loadSettings() {
    prefs.begin("voltix", false);
    server = prefs.getString("server", "");
    key = prefs.getString("key", "");
    secret = prefs.getString("secret", "");
    parseServer();

    // Power-on behaviour per channel: off, last state, or last state until the cloud restores its own.
    uint8_t pob[VOLTIX_MAX_CHANNELS];
    memset(pob, VOLTIX_POWER_ON_LAST, sizeof pob);
    memset(savedState, 0x7f, sizeof savedState);  // off, level unknown
    prefs.getBytes("po", pob, sizeof pob);
    prefs.getBytes("st", savedState, sizeof savedState);
    for (uint8_t i = 0; i < v().channelCount_; i++) {
      VoltixChannel &c = v().channels_[i];
      uint8_t s = savedState[c.number - 1];
      c.powerOn = pob[c.number - 1] <= VOLTIX_POWER_ON_CLOUD ? pob[c.number - 1] : (uint8_t)VOLTIX_POWER_ON_LAST;
      c.level = (s & 0x7f) <= 100 ? (int8_t)(s & 0x7f) : -1;
      c.on = c.powerOn != VOLTIX_POWER_ON_OFF && (s & 0x80);
      writeRelay(c);
    }
  }

  void saveStateIfDue() {
    uint32_t dirty = stateDirtyAt;
    if (!dirty || millis() - dirty < kStateSaveDelayMs) return;
    stateDirtyAt = 0;
    uint8_t st[VOLTIX_MAX_CHANNELS];
    memcpy(st, savedState, sizeof st);
    for (uint8_t i = 0; i < v().channelCount_; i++) {
      const VoltixChannel &c = v().channels_[i];
      st[c.number - 1] = (c.on ? 0x80 : 0) | (c.level < 0 ? 0x7f : (uint8_t)c.level);
    }
    if (memcmp(st, savedState, sizeof st) == 0) return;  // spare the flash
    memcpy(savedState, st, sizeof st);
    prefs.putBytes("st", st, sizeof st);
  }

  // --- setup portal -------------------------------------------------------------------------------------------

  static void onPortalSave() {
    VoltixInternals &vx = get();
    String s = vx.pServer.getValue(), k = vx.pKey.getValue(), sec = vx.pSecret.getValue();
    s.trim();
    k.trim();
    sec.trim();
    bool changed = false;
    if (s.length() && s != vx.server) {
      vx.server = s;
      vx.prefs.putString("server", s);
      changed = true;
    }
    if (k.length() && k != vx.key) {
      vx.key = k;
      vx.prefs.putString("key", k);
      changed = true;
    }
    if (sec.length() && sec != vx.secret) {
      vx.secret = sec;
      vx.prefs.putString("secret", sec);
      changed = true;
    }
    if (!changed) return;
    VLOG("board settings saved");
    vx.parseServer();
    // Reconnect with the new settings.
    if (vx.wsStarted) vx.ws.disconnect();
    vx.wsStarted = false;
    vx.wm.setConfigPortalTimeout(kPortalTimeoutS);
  }

  void startWifi() {
    uint8_t mac[6];
    WiFi.mode(WIFI_STA);
    WiFi.macAddress(mac);
    char ap[24];
    snprintf(ap, sizeof ap, "Voltix-Setup-%02X%02X", mac[4], mac[5]);
    apName = ap;

    wm.setDebugOutput(false);
    wm.setTitle("Voltix");
    wm.setConfigPortalBlocking(false);
    wm.setConnectTimeout(20);
    wm.setSaveParamsCallback(onPortalSave);
    pServer.setValue(server.c_str(), 96);
    pKey.setValue(key.c_str(), 64);
    wm.addParameter(&pServer);
    wm.addParameter(&pKey);
    wm.addParameter(&pSecret);
    std::vector<const char *> menu = {"wifi", "exit"};
    wm.setMenu(menu);

    if (haveCreds()) {
      // Joins the saved network; opens the portal for a while if that fails (e.g. new router).
      wm.setConfigPortalTimeout(kPortalTimeoutS);
      wm.autoConnect(apName.c_str());
    } else {
      VLOG("no board credentials: setup portal open on Wi-Fi \"%s\"", apName.c_str());
      wm.setConfigPortalTimeout(0);
      wm.startConfigPortal(apName.c_str());
    }
  }

  void serviceWifi() {
    if (wm.getConfigPortalActive()) {
      wm.process();
      return;
    }
    if (WiFi.status() != WL_CONNECTED && millis() - wifiKickAt > kWifiRetryMs) {
      wifiKickAt = millis();
      WiFi.reconnect();
    }
  }

  // --- cloud connection ---------------------------------------------------------------------------------------

  void beginOutage(uint32_t firstRetryMinMs, uint32_t firstRetryMaxMs) {
    outageStart = millis();
    // Spread reconnects so a server restart isn't hit by every board at once.
    jitter = 0.5f + (esp_random() % 1000) / 1000.0f;
    holdUntil = millis() + firstRetryMinMs + esp_random() % (firstRetryMaxMs - firstRetryMinMs + 1);
    headersAt = 0;
  }

  void refreshHeaders() {
    // The handshake timestamp must be within 60 s of server time, so headers are rebuilt every second
    // while disconnected; the library's own retries then always carry a fresh signature.
    uint32_t ts = now();
    String h;
    h.reserve(400);
    h += "x-voltix-key: " + key;
    h += "\r\nx-voltix-ts: " + String(ts);
    h += "\r\nx-voltix-sig: ";
    h += voltix::handshakeSignature(std::string(secret.c_str()), key.c_str(), ts).c_str();
    h += "\r\nx-voltix-channels: " + channelsHeader;
    h += "\r\nx-voltix-model: " + String(v().model_);
    h += "\r\nx-voltix-version: " + String(v().version_);
    h += "\r\nx-voltix-mac: " + WiFi.macAddress();
    h += "\r\nx-voltix-restore: ";
    h += restoreOnConnect ? "true" : "false";
    ws.setExtraHeaders(h.c_str());

    uint32_t backoff = VOLTIX_BACKOFF_MIN_MS + (millis() - outageStart) / 2;
    if (backoff > VOLTIX_BACKOFF_MAX_MS) backoff = VOLTIX_BACKOFF_MAX_MS;
    backoff = (uint32_t)(backoff * jitter);
    ws.setReconnectInterval(backoff < VOLTIX_BACKOFF_MIN_MS ? VOLTIX_BACKOFF_MIN_MS : backoff);
    headersAt = millis();
  }

  void startSocket() {
    if (tls) ws.beginSslWithCA(host.c_str(), port, kDevicePath, v().rootCa_);
    else ws.begin(host.c_str(), port, kDevicePath);
    ws.onEvent(onSocketEvent);
    // Client-side pings catch a dead link the server can't tell us about (Wi-Fi up, route gone).
    ws.enableHeartbeat(25000, 10000, 2);
    wsStarted = true;
    beginOutage(0, 2000);
    VLOG("connecting to %s://%s:%u", tls ? "wss" : "ws", host.c_str(), port);
  }

  void serviceConnection() {
    if (!haveCreds()) return;
    if (WiFi.status() != WL_CONNECTED) {
      if (ws.isConnected()) ws.disconnect();
      return;
    }
    if (!now()) return;  // waiting for SNTP: the handshake needs real time
    if (!wsStarted) startSocket();
    if (!ws.isConnected()) {
      if ((int32_t)(millis() - holdUntil) < 0) return;
      if (!headersAt || millis() - headersAt >= 1000) refreshHeaders();
    }
    ws.loop();
    if (dropSocket) {
      dropSocket = false;
      ws.disconnect();
    }
  }

  static void onSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
    VoltixInternals &vx = get();
    switch (type) {
      case WStype_CONNECTED:
        vx.invalid = 0;
        VLOG("connected");
        break;
      case WStype_DISCONNECTED:
        if (v().online_) VLOG("disconnected");
        v().online_ = false;
        vx.beginOutage(VOLTIX_BACKOFF_MIN_MS, 10000);
        break;
      case WStype_TEXT:
        vx.handleMessage(reinterpret_cast<const char *>(payload), length);
        break;
      default:
        break;
    }
  }

  void rejectMessage(const char *why) {
    VLOG("dropped message: %s", why);
    if (++invalid >= kMaxInvalid) dropSocket = true;
  }

  void handleMessage(const char *msg, size_t len) {
    if (len > VOLTIX_MAX_MESSAGE_BYTES) return rejectMessage("too large");
    voltix::Span payload, field;
    if (!voltix::jsonMember(msg, len, "payload", payload)) {
      // Unsigned clock sync the server sends right after the handshake: {"timestamp":<epoch>}.
      if (voltix::jsonMember(msg, len, "timestamp", field)) {
        uint32_t t = strtoul(msg + field.pos, nullptr, 10);
        if (t > kMinEpoch) {
          syncedEpoch = t;
          syncedAtMs = millis();
        }
        return;
      }
      return rejectMessage("malformed");
    }
    if (!voltix::verifySignature(msg, len, std::string(secret.c_str()), payload)) {
      return rejectMessage("bad signature");
    }
    voltix::Span header;
    if (!voltix::jsonMember(msg, len, "header", header) ||
        !voltix::jsonMember(msg + header.pos, header.len, "payloadVersion", field) ||
        strtol(msg + header.pos + field.pos, nullptr, 10) != VOLTIX_PAYLOAD_VERSION) {
      return rejectMessage("unsupported version");
    }

    JsonDocument doc;
    if (deserializeJson(doc, msg + payload.pos, payload.len)) return rejectMessage("malformed payload");
    JsonObjectConst p = doc.as<JsonObjectConst>();
    const char *type = p["type"] | "";
    const char *token = p["replyToken"] | "";
    const char *action = p["action"] | "";
    const char *deviceId = p["deviceId"] | "";
    if (!*token || !*action || !voltix::isFresh(p["createdAt"].as<uint32_t>(), now())) {
      return rejectMessage("stale");
    }
    if (!replay.accept(type, token, now())) return rejectMessage("replayed");
    if (strcmp(type, "request") != 0) return;

    if (key == deviceId) controllerRequest(action, p["value"].as<JsonObjectConst>());
    else deviceRequest(p);
  }

  // --- outgoing messages --------------------------------------------------------------------------------------

  bool send(JsonDocument &doc) {
    std::string raw;
    serializeJson(doc, raw);
    std::string msg = voltix::encodeMessage(raw, std::string(secret.c_str()));
    return ws.sendTXT(msg.c_str(), msg.size());
  }

  void base(JsonDocument &doc, const char *action, const char *deviceId, const char *clientId, const char *type) {
    char token[24];
    snprintf(token, sizeof token, "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random());
    doc["action"] = action;
    doc["clientId"] = clientId;
    doc["createdAt"] = now();
    doc["deviceId"] = deviceId;
    doc["replyToken"] = String(token);
    doc["type"] = type;
  }

  static bool takeToken(VoltixChannel &c) {
    uint32_t t = millis();
    float tokens = c.tokens + (t - c.tokensAt) / 1000.0f * VOLTIX_EVENT_REFILL_PER_S;
    c.tokens = tokens > VOLTIX_EVENT_BURST ? VOLTIX_EVENT_BURST : tokens;
    c.tokensAt = t;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  bool sendChannelEvent(VoltixChannel &c, const char *action, JsonObjectConst value, bool physical) {
    if (!v().online_ || !c.deviceId[0]) return false;
    bool telemetry = !strcmp(action, "currentTemperature") || !strcmp(action, "airQuality") ||
                     !strcmp(action, "powerUsage");
    if (telemetry && c.telemetryAt && millis() - c.telemetryAt < VOLTIX_TELEMETRY_MIN_INTERVAL_S * 1000UL) {
      return false;
    }
    if (!takeToken(c)) return false;
    JsonDocument doc;
    base(doc, action, c.deviceId, physical ? "physical" : "device", "event");
    doc["value"] = value;
    if (physical) doc["cause"]["type"] = "PHYSICAL_INTERACTION";
    if (!send(doc)) return false;
    if (telemetry) c.telemetryAt = millis();
    return true;
  }

  // Sends queued local changes (wall switch presses, offline changes) as the rate limit allows.
  void flushReports() {
    if (!v().online_) return;
    for (uint8_t i = 0; i < v().channelCount_; i++) {
      VoltixChannel &c = v().channels_[i];
      uint8_t pending = c.reportPending;
      if (!(pending & (kReportPower | kReportLevel))) continue;
      bool physical = pending & kReportPhysical;
      JsonDocument value;
      if (pending & kReportPower) {
        value["state"] = c.on ? "On" : "Off";
        if (!sendChannelEvent(c, "setPowerState", value.as<JsonObjectConst>(), physical)) continue;
        clearReport(c, kReportPower);
      } else {
        value["powerLevel"] = c.level < 0 ? 0 : c.level;
        if (!sendChannelEvent(c, "setPowerLevel", value.as<JsonObjectConst>(), physical)) continue;
        clearReport(c, kReportLevel);
      }
    }
  }

  // --- requests from the cloud --------------------------------------------------------------------------------

  void controllerRequest(const char *action, JsonObjectConst value) {
    if (!strcmp(action, "config")) return applyConfig(value);
    if (!strcmp(action, "otaUpdateAvailable")) return offerOta(value);
    if (!strcmp(action, "restart")) {
      VLOG("restart requested by the cloud");
      restartAt = millis() | 1;
    }
  }

  void applyConfig(JsonObjectConst value) {
    bool firstAfterBoot = restoreOnConnect;
    bool pobChanged = false;
    uint8_t pob[VOLTIX_MAX_CHANNELS];
    memset(pob, VOLTIX_POWER_ON_LAST, sizeof pob);
    prefs.getBytes("po", pob, sizeof pob);
    for (JsonObjectConst ch : value["channels"].as<JsonArrayConst>()) {
      VoltixChannel *c = v().channel(ch["channel"] | 0);
      if (!c) continue;
      strlcpy(c->deviceId, ch["deviceId"] | "", sizeof c->deviceId);
      const char *b = ch["powerOnBehavior"] | "last";
      uint8_t behaviour = !strcmp(b, "off")     ? VOLTIX_POWER_ON_OFF
                          : !strcmp(b, "cloud") ? VOLTIX_POWER_ON_CLOUD
                                                : VOLTIX_POWER_ON_LAST;
      c->powerOn = behaviour;
      if (pob[c->number - 1] != behaviour) {
        pob[c->number - 1] = behaviour;
        pobChanged = true;
      }
      // After boot the cloud only knows the state from before the power cut; tell it what we chose,
      // except where it is about to restore its own state.
      if (firstAfterBoot && c->relayPin != VOLTIX_NO_PIN && behaviour != VOLTIX_POWER_ON_CLOUD) {
        queueReport(*c, kReportPower);
      }
    }
    if (pobChanged) prefs.putBytes("po", pob, sizeof pob);
    restoreOnConnect = false;
    v().online_ = true;
    markFirmwareValid();
    VLOG("online (%u channels)", v().channelCount_);
  }

  void deviceRequest(JsonObjectConst p) {
    const char *action = p["action"] | "";
    VoltixChannel *c = byDeviceId(p["deviceId"] | "");
    JsonDocument res;
    res["action"] = action;
    res["clientId"] = p["clientId"] | "";
    res["createdAt"] = now();
    res["deviceId"] = p["deviceId"] | "";
    res["replyToken"] = p["replyToken"] | "";
    res["type"] = "response";
    JsonObject out = res["value"].to<JsonObject>();
    const char *message = "OK";
    bool ok = c && applyAction(*c, action, p["value"].as<JsonObjectConst>(), out, message);
    if (!c) message = "unknown device";
    if (!ok) res["value"].to<JsonObject>();  // no partial values on failure
    res["success"] = ok;
    res["message"] = message;
    send(res);
  }

  bool applyAction(VoltixChannel &c, const char *action, JsonObjectConst value, JsonObject out,
                   const char *&message) {
    bool relay = c.relayPin != VOLTIX_NO_PIN;
    if (relay && !strcmp(action, "setPowerState")) {
      const char *state = value["state"] | "";
      if (strcmp(state, "On") && strcmp(state, "Off")) {
        message = "state must be On or Off";
        return false;
      }
      c.on = !strcmp(state, "On");
      writeRelay(c);
      markDirty();
      out["state"] = state;
      return true;
    }
    VoltixActionHandler handler = v().handler_;
    if (handler && handler(c, action, value, out)) {
      // Track what the sketch reports so power-on "last" and offline reports stay right.
      if (out["state"].is<const char *>()) c.on = !strcmp(out["state"].as<const char *>(), "On");
      if (out["powerLevel"].is<int>()) c.level = (int8_t)constrain(out["powerLevel"].as<int>(), 0, 100);
      markDirty();
      return true;
    }
    out.clear();
    bool set = !strcmp(action, "setPowerLevel");
    if (set || !strcmp(action, "adjustPowerLevel")) {
      // shortcut: level is stored and reported but only drives hardware through onAction (fan speed
      // hardware differs per board).
      int level = set ? (value["powerLevel"] | -1) : (c.level < 0 ? 0 : c.level) + (value["powerLevelDelta"] | 0);
      if (set && level < 0) {
        message = "powerLevel missing";
        return false;
      }
      c.level = (int8_t)constrain(level, 0, 100);
      markDirty();
      out["powerLevel"] = c.level;
      return true;
    }
    message = "not supported by this board";
    return false;
  }

  // --- OTA ----------------------------------------------------------------------------------------------------

  void otaStatus(const char *status, int progress = -1, const char *error = nullptr) {
    if (!ws.isConnected()) return;
    JsonDocument doc;
    base(doc, "otaStatus", key.c_str(), "device", "event");
    JsonObject value = doc["value"].to<JsonObject>();
    value["version"] = otaVersion;
    value["status"] = status;
    if (progress >= 0) value["progress"] = progress;
    if (error) value["error"] = error;
    send(doc);
    VLOG("ota %s: %s%s%s", otaVersion.c_str(), status, error ? " - " : "", error ? error : "");
  }

  void offerOta(JsonObjectConst value) {
    if (otaRunning || otaPending) return;
    otaUrl = value["url"] | "";
    otaVersion = value["version"] | "";
    otaSha = value["sha256"] | "";
    otaSize = value["size"] | 0;
    if (otaVersion == v().version_ && !(value["forceUpdate"] | false)) {
      return otaStatus("rejected", -1, "already running this version");
    }
    if (!otaUrl.length() || otaSha.length() != 64 || !otaSize) return otaStatus("rejected", -1, "invalid offer");
    otaPending = true;
  }

  // Keeps the socket, wall switches and heartbeats alive during a long blocking download.
  void pump() {
    ws.loop();
    saveStateIfDue();
  }

  void runOta() {
    otaPending = false;
    otaRunning = true;
    otaStatus("accepted");
    const char *error = downloadAndInstall();
    otaRunning = false;
    if (error) return otaStatus("failed", -1, error);
    otaStatus("installing", 100);
    for (int i = 0; i < 20; i++) {  // let the last status leave before rebooting
      ws.loop();
      delay(25);
    }
    ws.disconnect();
    ESP.restart();
  }

  const char *downloadAndInstall() {
    std::unique_ptr<WiFiClient> client;
    if (otaUrl.startsWith("https://")) {
      WiFiClientSecure *secure = new WiFiClientSecure();
      secure->setCACert(v().rootCa_);
      client.reset(secure);
    } else {
      client.reset(new WiFiClient());
    }
    HTTPClient http;
    http.setTimeout(15000);
    if (!http.begin(*client, otaUrl)) return "bad download URL";
    int code = http.GET();
    if (code != HTTP_CODE_OK) {
      http.end();
      return code < 0 ? "download failed" : "download refused by server";
    }
    int len = http.getSize();
    if (len <= 0 || (uint32_t)len != otaSize) {
      http.end();
      return "unexpected size";
    }
    if (!Update.begin(len)) {
      http.end();
      return "image does not fit the OTA partition";
    }

    WiFiClient *stream = http.getStreamPtr();
    voltix::Sha256 sha;
    static uint8_t buf[2048];
    size_t done = 0;
    int lastTenth = 0;
    uint32_t lastData = millis();
    while (done < (size_t)len) {
      size_t avail = stream->available();
      if (!avail) {
        if (!stream->connected() || millis() - lastData > 20000) break;
        delay(2);
        pump();
        continue;
      }
      size_t want = (size_t)len - done;
      if (want > sizeof buf) want = sizeof buf;
      if (avail < want) want = avail;
      size_t n = stream->readBytes(buf, want);
      if (!n) continue;
      lastData = millis();
      sha.update(buf, n);
      if (Update.write(buf, n) != n) {
        Update.abort();
        http.end();
        return "flash write failed";
      }
      done += n;
      int tenth = (int)(done * 10 / len);
      if (tenth != lastTenth) {
        lastTenth = tenth;
        otaStatus("downloading", tenth * 10);
      }
      pump();
    }
    http.end();
    if (done != (size_t)len) {
      Update.abort();
      return "download interrupted";
    }
    otaStatus("verifying", 100);
    uint8_t digest[32];
    sha.finish(digest);
    std::string expected(otaSha.c_str());
    for (char &ch : expected) ch = (char)tolower(ch);
    if (voltix::hex(digest, sizeof digest) != expected) {
      Update.abort();
      return "checksum mismatch";
    }
    if (!Update.end()) return "image rejected by bootloader checks";
    return nullptr;
  }

  void markFirmwareValid() {
    if (validated) return;
    validated = true;
#ifdef VOLTIX_ROLLBACK
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY) {
      esp_ota_mark_app_valid_cancel_rollback();
      VLOG("new firmware confirmed");
    }
#endif
  }

  void checkRollback() {
    if (validated || millis() < kRollbackAfterMs) return;
#ifdef VOLTIX_ROLLBACK
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
        state == ESP_OTA_IMG_PENDING_VERIFY) {
      VLOG("new firmware never reached the cloud: rolling back");
      esp_ota_mark_app_invalid_rollback_and_reboot();
    }
#endif
    validated = true;
  }

  // --- inputs (own task, so switches work even while the network blocks) -----------------------------------

  static void inputTask(void *) {
    VoltixInternals &vx = get();
    VoltixClass &v = Voltix;
    for (;;) {
      uint32_t t = millis();
      for (uint8_t i = 0; i < v.channelCount_; i++) {
        VoltixChannel &c = v.channels_[i];
        if (c.switchPin == VOLTIX_NO_PIN) continue;
        bool raw = digitalRead(c.switchPin);
        if (raw != c.switchRaw) {
          c.switchRaw = raw;
          c.switchChangedAt = t;
        } else if (raw != c.switchStable && t - c.switchChangedAt >= kDebounceMs) {
          c.switchStable = raw;
          // Momentary buttons pull the pin LOW while pressed; latching switches toggle on every flip.
          if (c.switchMode == VOLTIX_LATCHING || raw == LOW) v.setPowerState(c.number, !c.on, true);
        }
      }
      if (v.resetPin_ != VOLTIX_NO_PIN) {
        if (digitalRead(v.resetPin_) == LOW) {
          if (!vx.resetPressedAt) vx.resetPressedAt = t | 1;
          else if (t - vx.resetPressedAt >= kResetHoldMs) v.factoryReset();
        } else {
          vx.resetPressedAt = 0;
        }
      }
      vTaskDelay(pdMS_TO_TICKS(10));
    }
  }
};

// ----------------------------------------------------------------------------------------------------------------

void VoltixClass::addChannel(uint8_t number, const char *type, uint8_t relayPin) {
  if (number < 1 || number > VOLTIX_MAX_CHANNELS || channel(number) || channelCount_ >= VOLTIX_MAX_CHANNELS) {
    VLOG("addChannel(%u): invalid or duplicate channel number", number);
    return;
  }
  VoltixChannel &c = channels_[channelCount_++];
  c.number = number;
  strlcpy(c.type, type, sizeof c.type);
  c.relayPin = relayPin;
  if (relayPin != VOLTIX_NO_PIN) {
    pinMode(relayPin, OUTPUT);
    VoltixInternals::writeRelay(c);
  }
}

void VoltixClass::addSwitchInput(uint8_t number, uint8_t pin, VoltixSwitchMode mode) {
  VoltixChannel *c = channel(number);
  if (!c) {
    VLOG("addSwitchInput(%u): add the channel first", number);
    return;
  }
  pinMode(pin, INPUT_PULLUP);
  c->switchPin = pin;
  c->switchMode = mode;
  c->switchRaw = c->switchStable = digitalRead(pin);
}

VoltixChannel *VoltixClass::channel(uint8_t number) {
  for (uint8_t i = 0; i < channelCount_; i++) {
    if (channels_[i].number == number) return &channels_[i];
  }
  return nullptr;
}

void VoltixClass::begin(const char *model, const char *version) {
  VoltixInternals &vx = VoltixInternals::get();
  model_ = model;
  version_ = version;
  if (!rootCa_) rootCa_ = VOLTIX_DEFAULT_ROOT_CA;

  vx.channelsHeader = "";
  for (uint8_t i = 0; i < channelCount_; i++) {
    if (i) vx.channelsHeader += ',';
    vx.channelsHeader += String(channels_[i].number) + ':' + channels_[i].type;
  }
  VLOG("%s %s, %u channels", model, version, channelCount_);

  vx.loadSettings();  // also applies each channel's power-on state
  if (resetPin_ != VOLTIX_NO_PIN) pinMode(resetPin_, INPUT_PULLUP);
  xTaskCreatePinnedToCore(VoltixInternals::inputTask, "voltix-in", 4096, nullptr, 2, nullptr, 1);

  vx.startWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
}

void VoltixClass::loop() {
  VoltixInternals &vx = VoltixInternals::get();
  vx.serviceWifi();
  vx.serviceConnection();
  vx.flushReports();
  vx.saveStateIfDue();
  if (vx.otaPending) vx.runOta();
  vx.checkRollback();
  if (vx.restartAt && millis() - vx.restartAt > 1000) {
    vx.prefs.end();
    ESP.restart();
  }
}

bool VoltixClass::setPowerState(uint8_t number, bool on, bool physical) {
  VoltixChannel *c = channel(number);
  if (!c) return false;
  c->on = on;
  VoltixInternals::writeRelay(*c);
  VoltixInternals::get().markDirty();
  queueReport(*c, kReportPower | (physical ? kReportPhysical : 0));
  return true;
}

bool VoltixClass::setPowerLevel(uint8_t number, int level, bool physical) {
  VoltixChannel *c = channel(number);
  if (!c) return false;
  c->level = (int8_t)constrain(level, 0, 100);
  VoltixInternals::get().markDirty();
  queueReport(*c, kReportLevel | (physical ? kReportPhysical : 0));
  return true;
}

bool VoltixClass::sendEvent(uint8_t number, const char *action, JsonObjectConst value, bool physical) {
  VoltixChannel *c = channel(number);
  return c && VoltixInternals::get().sendChannelEvent(*c, action, value, physical);
}

bool VoltixClass::sendTemperature(uint8_t number, float celsius, float humidity) {
  JsonDocument doc;
  doc["temperature"] = roundf(celsius * 10) / 10;
  if (!isnan(humidity)) doc["humidity"] = roundf(humidity);
  return sendEvent(number, "currentTemperature", doc.as<JsonObjectConst>());
}

bool VoltixClass::sendMotion(uint8_t number, bool detected) {
  JsonDocument doc;
  doc["state"] = detected ? "detected" : "notDetected";
  return sendEvent(number, "motion", doc.as<JsonObjectConst>());
}

bool VoltixClass::sendContact(uint8_t number, bool open) {
  JsonDocument doc;
  doc["state"] = open ? "open" : "closed";
  return sendEvent(number, "setContactState", doc.as<JsonObjectConst>());
}

bool VoltixClass::sendDoorbellPress(uint8_t number) {
  JsonDocument doc;
  doc["state"] = "pressed";
  return sendEvent(number, "DoorbellPress", doc.as<JsonObjectConst>(), true);
}

bool VoltixClass::sendPowerUsage(uint8_t number, float watts, float volts, float amps) {
  JsonDocument doc;
  doc["power"] = watts;
  if (!isnan(volts)) doc["voltage"] = volts;
  if (!isnan(amps)) doc["current"] = amps;
  return sendEvent(number, "powerUsage", doc.as<JsonObjectConst>());
}

bool VoltixClass::sendAirQuality(uint8_t number, float pm1, float pm2_5, float pm10) {
  JsonDocument doc;
  doc["pm1"] = pm1;
  doc["pm2_5"] = pm2_5;
  doc["pm10"] = pm10;
  return sendEvent(number, "airQuality", doc.as<JsonObjectConst>());
}

void VoltixClass::factoryReset() {
  VLOG("factory reset: erasing Wi-Fi and board credentials");
  VoltixInternals &vx = VoltixInternals::get();
  vx.prefs.clear();
  vx.wm.resetSettings();
  delay(200);
  ESP.restart();
}
