#include "VoltixLocal.h"

#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <esp_system.h>
#include <mdns.h>

#include "Voltix.h"
#include "VoltixCrypto.h"

namespace {

const uint32_t kPeersMaxAgeMs = 60000;
const uint32_t kPeersSearchMs = 2000;
const char *kOff = "Local control is off. Set a home PIN in the Voltix app (Home settings).";

// One page, no external files: works with the internet down. Names are inserted with textContent only.
const char kPage[] PROGMEM = R"html(<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Voltix</title><style>
body{font-family:system-ui,sans-serif;margin:0;background:#f4f5f7;color:#111}main{max-width:480px;margin:auto;padding:16px}
h1{font-size:20px;margin:8px 0 2px}h2{font-size:15px;margin:20px 0 4px}.m{color:#666;font-size:13px}
.c{background:#fff;border-radius:12px;padding:12px 14px;margin:10px 0;box-shadow:0 1px 2px #0002}
.r{display:flex;align-items:center;justify-content:space-between;gap:12px}
button{font:inherit;border:0;border-radius:999px;padding:8px 18px;background:#e4e6ea;min-width:64px}
button.on{background:#f59e0b;color:#fff}input{font:inherit;width:100%;box-sizing:border-box}
#pin{padding:10px;border:1px solid #bbb;border-radius:8px;letter-spacing:6px;text-align:center}
.e{color:#b91c1c}a{color:#2563eb}</style></head><body><main>
<h1 id="t">Voltix</h1><div class="m" id="s">Home Wi-Fi control</div>
<form id="f" class="c" hidden><p>Enter your home PIN</p><input id="pin" inputmode="numeric" autocomplete="off"
maxlength="8" required><p class="r"><button>Unlock</button><span id="e" class="e"></span></p></form>
<div id="l"></div><div id="p"></div></main><script>
const $=i=>document.getElementById(i);let busy=0;
async function api(u,b){const r=await fetch(u,b?{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify(b)}:{});let j={};try{j=await r.json()}catch(e){}return{s:r.status,j}}
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
async function load(){const{s,j}=await api('/api/state');$('f').hidden=s!=401;
if(s==401)return;if(s!=200){$('s').textContent=j.message||'Not available';return}
$('t').textContent=j.name;$('s').textContent=j.cloud?'Connected to the Voltix cloud':'Working without internet';
if(!busy&&document.activeElement.type!='range')draw(j.channels)}
function draw(cs){const l=$('l');l.textContent='';for(const c of cs){const d=el('div','c'),r=el('div','r');
r.append(el('div','',c.name||'Channel '+c.ch));if(c.power){const b=el('button',c.on?'on':'',c.on?'On':'Off');
b.onclick=()=>send({channel:c.ch,on:!c.on});r.append(b)}d.append(r);if(c.dim){const i=el('input');i.type='range';
i.min=0;i.max=100;i.value=Math.max(c.level,0);i.onchange=()=>send({channel:c.ch,level:+i.value});d.append(i)}l.append(d)}}
async function send(b){busy=1;const{s,j}=await api('/api/channel',b);busy=0;if(s!=200)alert(j.message||'Failed');load()}
async function peers(){const{s,j}=await api('/api/peers');if(s!=200)return;const p=$('p');p.textContent='';
if(j.peers.length)p.append(el('h2','','Other Voltix boards'),el('div','m','Each board asks for the PIN once.'));
for(const x of j.peers){const d=el('div','c'),a=el('a','',x.name+' ('+x.ip+')');a.href='http://'+x.ip+'/';d.append(a);p.append(d)}
if(j.searching)setTimeout(peers,2500)}
$('f').onsubmit=async e=>{e.preventDefault();const{s,j}=await api('/api/login',{pin:$('pin').value});$('pin').value='';
$('e').textContent=s==200?'':j.message||'Wrong PIN';if(s==200){load();peers()}};
load().then(peers);setInterval(load,2000);
</script></body></html>)html";

// Random 128-bit session token (hardware RNG; Wi-Fi is on, so it is truly random).
void hexToken(char out[33]) {
  uint8_t b[16];
  esp_fill_random(b, sizeof b);
  for (int i = 0; i < 16; i++) snprintf(out + 2 * i, 3, "%02x", b[i]);
}

}  // namespace

void VoltixLocal::setPin(const char *secret, const char *verifier) {
  if (secret_ == secret && verifier_ == verifier) return;
  secret_ = secret;
  verifier_ = verifier;
  memset(sessions_, 0, sizeof sessions_);
  lockout_.succeeded();
}

void VoltixLocal::loop(bool wifiUp, bool portalOpen) {
  if (portalOpen) {
    if (running_) stop();
    return;
  }
  if (!running_) {
    if (wifiUp && host_[0]) start();
    return;
  }
  server_.handleClient();
  servicePeers();
}

void VoltixLocal::start() {
  static const char *headers[] = {"Cookie", "Origin"};
  server_.collectHeaders(headers, 2);
  server_.on("/", HTTP_GET, [this] { handlePage(); });
  server_.on("/api/login", HTTP_POST, [this] { handleLogin(); });
  server_.on("/api/state", HTTP_GET, [this] { handleState(); });
  server_.on("/api/channel", HTTP_POST, [this] { handleChannel(); });
  server_.on("/api/peers", HTTP_GET, [this] { handlePeers(); });
  server_.onNotFound([this] {
    if (allowed(false)) fail(404, "Not found");
  });
  server_.begin();
  if (MDNS.begin(host_)) {
    MDNS.addService("http", "tcp", 80);
    MDNS.addService("voltix", "tcp", 80);
  }
  running_ = true;
  Serial.printf("[voltix] local page: http://%s.local and http://%s\n", host_, WiFi.localIP().toString().c_str());
}

void VoltixLocal::stop() {
  server_.stop();
  MDNS.end();
  if (search_) mdns_query_async_delete(static_cast<mdns_search_once_t *>(search_));
  search_ = nullptr;
  running_ = false;
}

void VoltixLocal::reply(int code, const String &json) {
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(code, "application/json", json);
}

void VoltixLocal::fail(int code, const char *message) {
  JsonDocument doc;
  doc["message"] = message;
  String out;
  serializeJson(doc, out);
  reply(code, out);
}

// Only the board's own names (no DNS rebinding), and POSTs only from its own page (no cross-site requests).
bool VoltixLocal::allowed(bool post) {
  String host = server_.hostHeader();
  if (!voltix::localHostAllowed(host.c_str(), WiFi.localIP().toString().c_str(), host_)) {
    fail(403, "Unknown host name");
    return false;
  }
  if (post && !server_.header("Origin").equalsIgnoreCase("http://" + host)) {
    fail(403, "Cross-site request refused");
    return false;
  }
  return true;
}

bool VoltixLocal::signedIn() {
  String cookie = server_.header("Cookie");
  int at = cookie.indexOf("vx_local=");
  if (at < 0 || cookie.length() < (unsigned)at + 9 + 32) return false;
  const char *token = cookie.c_str() + at + 9;
  bool ok = false;
  for (const char *s : sessions_) ok |= s[0] && voltix::constantTimeEquals(token, 32, s, 32);
  return ok;
}

void VoltixLocal::handlePage() {
  if (!allowed(false)) return;
  server_.sendHeader("Content-Security-Policy",
                     "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; "
                     "form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
  server_.sendHeader("X-Content-Type-Options", "nosniff");
  server_.sendHeader("Referrer-Policy", "no-referrer");
  server_.send_P(200, "text/html; charset=utf-8", kPage);
}

void VoltixLocal::handleLogin() {
  if (!allowed(true)) return;
  if (verifier_.empty()) return fail(403, kOff);
  uint32_t t = millis();
  if (lockout_.locked(t)) {
    server_.sendHeader("Retry-After", String(lockout_.secondsLeft(t)));
    return fail(429, "Too many wrong PINs. Try again in 5 minutes.");
  }
  JsonDocument doc;
  String body = server_.arg("plain");
  if (body.length() > 200 || deserializeJson(doc, body)) return fail(400, "Bad request");
  const char *pin = doc["pin"] | "";
  size_t n = strlen(pin);
  bool digits = n >= 6 && n <= 8;
  for (size_t i = 0; i < n; i++) digits &= isdigit((unsigned char)pin[i]) != 0;
  std::string given = digits ? voltix::localPinVerifier(secret_, pin) : std::string();
  if (!digits || !voltix::constantTimeEquals(given.data(), given.size(), verifier_.data(), verifier_.size())) {
    lockout_.failed(t);
    return fail(401, lockout_.locked(t) ? "Too many wrong PINs. Try again in 5 minutes." : "Wrong PIN");
  }
  lockout_.succeeded();
  char *session = sessions_[nextSession_];
  nextSession_ = (nextSession_ + 1) % kSessions;  // a ninth sign-in replaces the oldest
  hexToken(session);
  server_.sendHeader("Set-Cookie",
                     String("vx_local=") + session + "; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict");
  reply(200, "{}");
}

void VoltixLocal::handleState() {
  if (!allowed(false)) return;
  if (verifier_.empty()) return fail(403, kOff);
  if (!signedIn()) return fail(401, "Enter the PIN");
  JsonDocument doc;
  doc["name"] = host_;
  doc["cloud"] = Voltix.connected();
  JsonArray list = doc["channels"].to<JsonArray>();
  for (uint8_t i = 0; i < Voltix.channelCount_; i++) {
    const VoltixChannel &c = Voltix.channels_[i];
    bool dim = !strcmp(c.type, "fan") || !strcmp(c.type, "dimSwitch");
    if (c.relayPin == VOLTIX_NO_PIN && !dim) continue;  // sensors and sketch-only channels
    JsonObject o = list.add<JsonObject>();
    o["ch"] = c.number;
    o["name"] = c.name;
    o["type"] = c.type;
    o["on"] = c.on;
    o["level"] = c.level;
    o["power"] = c.relayPin != VOLTIX_NO_PIN;
    o["dim"] = dim;
  }
  String out;
  serializeJson(doc, out);
  reply(200, out);
}

void VoltixLocal::handleChannel() {
  if (!allowed(true)) return;
  if (verifier_.empty()) return fail(403, kOff);
  if (!signedIn()) return fail(401, "Enter the PIN");
  JsonDocument doc, value;
  String body = server_.arg("plain");
  if (body.length() > 200 || deserializeJson(doc, body)) return fail(400, "Bad request");
  VoltixChannel *c = Voltix.channel(doc["channel"] | 0);
  if (!c) return fail(404, "Unknown channel");
  const char *action;
  if (doc["on"].is<bool>()) {
    action = "setPowerState";
    value["state"] = doc["on"].as<bool>() ? "On" : "Off";
  } else if (doc["level"].is<int>()) {
    action = "setPowerLevel";
    value["powerLevel"] = constrain(doc["level"].as<int>(), 0, 100);
  } else {
    return fail(400, "Send on or level");
  }
  const char *message = "OK";
  if (!Voltix.localAction(*c, action, value.as<JsonObjectConst>(), message)) return fail(422, message);
  reply(200, "{}");
}

void VoltixLocal::handlePeers() {
  if (!allowed(false)) return;
  if (verifier_.empty()) return fail(403, kOff);
  if (!signedIn()) return fail(401, "Enter the PIN");
  if (!search_ && (!peersAt_ || millis() - peersAt_ > kPeersMaxAgeMs)) {
    search_ = mdns_query_async_new(nullptr, "_voltix", "_tcp", MDNS_TYPE_PTR, kPeersSearchMs, 20, nullptr);
  }
  reply(200, String("{\"searching\":") + (search_ ? "true" : "false") + ",\"peers\":" + peers_ + "}");
}

// Collects the answer of a running mDNS query without blocking the loop.
void VoltixLocal::servicePeers() {
  if (!search_) return;
  mdns_result_t *results = nullptr;
  if (!mdns_query_async_get_results(static_cast<mdns_search_once_t *>(search_), 0, &results)) return;
  JsonDocument doc;
  JsonArray list = doc.to<JsonArray>();
  for (mdns_result_t *r = results; r; r = r->next) {
    if (!r->hostname || !strcmp(r->hostname, host_)) continue;
    for (mdns_ip_addr_t *a = r->addr; a; a = a->next) {
      if (a->addr.type != ESP_IPADDR_TYPE_V4) continue;
      JsonObject o = list.add<JsonObject>();
      o["name"] = String(r->hostname) + ".local";
      o["ip"] = IPAddress(a->addr.u_addr.ip4.addr).toString();
      break;
    }
  }
  mdns_query_results_free(results);
  mdns_query_async_delete(static_cast<mdns_search_once_t *>(search_));
  search_ = nullptr;
  peersAt_ = millis() | 1;
  peers_ = "";
  serializeJson(doc, peers_);
}
