#include "VoltixProtocol.h"

#include <cstdio>
#include <cstring>

#include "VoltixCrypto.h"

namespace voltix {

namespace {

const size_t kBad = SIZE_MAX;

size_t skipWs(const char *s, size_t n, size_t i) {
  while (i < n && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
  return i;
}

// s[i] must be '"'; returns the index just past the closing quote.
size_t skipString(const char *s, size_t n, size_t i) {
  i++;
  while (i < n) {
    if (s[i] == '\\') i += 2;
    else if (s[i] == '"') return i + 1;
    else i++;
  }
  return kBad;
}

}  // namespace

size_t jsonSkipValue(const char *s, size_t n, size_t i) {
  if (i >= n) return kBad;
  char c = s[i];
  if (c == '"') return skipString(s, n, i);
  if (c == '{' || c == '[') {
    int depth = 0;
    while (i < n) {
      char ch = s[i];
      if (ch == '"') {
        i = skipString(s, n, i);
        if (i == kBad) return kBad;
        continue;
      }
      if (ch == '{' || ch == '[') depth++;
      else if (ch == '}' || ch == ']') {
        if (--depth == 0) return i + 1;
      }
      i++;
    }
    return kBad;
  }
  // number, true, false, null
  size_t start = i;
  while (i < n && !strchr(",}] \n\r\t", s[i])) i++;
  return i > start ? i : kBad;
}

bool jsonMember(const char *s, size_t n, const char *key, Span &out) {
  size_t keyLen = strlen(key);
  size_t i = skipWs(s, n, 0);
  if (i >= n || s[i] != '{') return false;
  i++;
  while (i < n) {
    i = skipWs(s, n, i);
    if (i >= n || s[i] != '"') return false;
    size_t keyEnd = skipString(s, n, i);
    if (keyEnd == kBad) return false;
    bool match = keyEnd - i - 2 == keyLen && memcmp(s + i + 1, key, keyLen) == 0;
    i = skipWs(s, n, keyEnd);
    if (i >= n || s[i] != ':') return false;
    i = skipWs(s, n, i + 1);
    size_t valueEnd = jsonSkipValue(s, n, i);
    if (valueEnd == kBad) return false;
    if (match) {
      out.pos = i;
      out.len = valueEnd - i;
      return true;
    }
    i = skipWs(s, n, valueEnd);
    if (i < n && s[i] == ',') i++;
    else return false;
  }
  return false;
}

bool extractRawPayload(const char *s, size_t n, Span &out) {
  return jsonMember(s, n, "payload", out) && s[out.pos] == '{';
}

std::string hmacBase64(const std::string &secret, const char *data, size_t len) {
  uint8_t mac[32];
  hmacSha256(secret.data(), secret.size(), data, len, mac);
  return base64(mac, sizeof mac);
}

std::string encodeMessage(const std::string &rawPayload, const std::string &secret) {
  char header[64];
  snprintf(header, sizeof header, "{\"header\":{\"payloadVersion\":%d,\"signatureVersion\":%d},\"payload\":",
           VOLTIX_PAYLOAD_VERSION, VOLTIX_SIGNATURE_VERSION);
  std::string out(header);
  out.reserve(out.size() + rawPayload.size() + 80);
  out += rawPayload;
  out += ",\"signature\":{\"HMAC\":\"";
  out += hmacBase64(secret, rawPayload.data(), rawPayload.size());
  out += "\"}}";
  return out;
}

bool verifySignature(const char *msg, size_t n, const std::string &secret, Span &payload) {
  Span sigObj, hmac;
  if (!extractRawPayload(msg, n, payload)) return false;
  if (!jsonMember(msg, n, "signature", sigObj) || msg[sigObj.pos] != '{') return false;
  if (!jsonMember(msg + sigObj.pos, sigObj.len, "HMAC", hmac) || hmac.len < 2) return false;
  const char *given = msg + sigObj.pos + hmac.pos + 1;  // inside the quotes; base64 never needs escapes
  if (given[-1] != '"') return false;
  std::string expected = hmacBase64(secret, msg + payload.pos, payload.len);
  return constantTimeEquals(given, hmac.len - 2, expected.data(), expected.size());
}

std::string handshakeSignature(const std::string &secret, const char *keyId, uint32_t ts) {
  std::string data(keyId);
  char buf[16];
  snprintf(buf, sizeof buf, "\n%lu", (unsigned long)ts);
  data += buf;
  return hmacBase64(secret, data.data(), data.size());
}

bool ReplayGuard::accept(const char *type, const char *replyToken, uint32_t now) {
  // FNV-1a over "type:token": 64 bits make an accidental collision a non-issue.
  uint64_t h = 1469598103934665603ULL;
  auto mix = [&h](const char *p) {
    for (; *p; p++) h = (h ^ (uint8_t)*p) * 1099511628211ULL;
  };
  mix(type);
  mix(":");
  mix(replyToken);
  for (int i = 0; i < kSize; i++) {
    if (hash_[i] == h && expires_[i] > now) return false;
  }
  hash_[next_] = h;
  // Twice the window: a message is fresh for VOLTIX_REPLAY_WINDOW_S on either side of its createdAt.
  expires_[next_] = now + 2 * VOLTIX_REPLAY_WINDOW_S;
  next_ = (next_ + 1) % kSize;
  return true;
}

}  // namespace voltix
