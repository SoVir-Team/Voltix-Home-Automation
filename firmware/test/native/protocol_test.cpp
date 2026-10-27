// Native tests for the portable SDK layer, checked against the same vectors the Node protocol package uses
// (packages/protocol/test-vectors.json). Run with `npm run test:firmware` from the repo root.
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include "VoltixCrypto.h"
#include "VoltixProtocol.h"

using namespace voltix;

static int failures = 0;
static int checks = 0;
#define CHECK(cond)                                                  \
  do {                                                               \
    checks++;                                                        \
    if (!(cond)) {                                                   \
      failures++;                                                    \
      fprintf(stderr, "FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); \
    }                                                                \
  } while (0)

static std::string sha256Hex(const std::string &s) {
  Sha256 sha;
  sha.update(s.data(), s.size());
  uint8_t out[32];
  sha.finish(out);
  return hex(out, 32);
}

static std::string hmacHex(const std::string &key, const std::string &data) {
  uint8_t out[32];
  hmacSha256(key.data(), key.size(), data.data(), data.size(), out);
  return hex(out, 32);
}

// --- minimal JSON access for the vectors file (uses the SDK's own scanner to find values) ---

static void appendUtf8(std::string &out, unsigned cp) {
  if (cp < 0x80) out += (char)cp;
  else if (cp < 0x800) {
    out += (char)(0xC0 | (cp >> 6));
    out += (char)(0x80 | (cp & 63));
  } else {
    out += (char)(0xE0 | (cp >> 12));
    out += (char)(0x80 | ((cp >> 6) & 63));
    out += (char)(0x80 | (cp & 63));
  }
}

static std::string unescape(const std::string &json, Span v) {
  std::string out;
  for (size_t i = v.pos + 1; i < v.pos + v.len - 1; i++) {
    char c = json[i];
    if (c != '\\') {
      out += c;
      continue;
    }
    char e = json[++i];
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'u':
        appendUtf8(out, (unsigned)std::stoul(json.substr(i + 1, 4), nullptr, 16));
        i += 4;
        break;
      default: out += e;  // \" \\ \/
    }
  }
  return out;
}

struct Json {
  std::string text;
  Span span;
  Json get(const char *key) const {
    Span m;
    if (!jsonMember(text.data() + span.pos, span.len, key, m)) {
      fprintf(stderr, "vectors: missing key %s\n", key);
      exit(2);
    }
    m.pos += span.pos;
    return {text, m};
  }
  Json at(size_t index) const {
    size_t i = span.pos + 1;
    for (size_t k = 0;; k++) {
      while (strchr(" \n\r\t,", text[i])) i++;
      if (text[i] == ']') {
        fprintf(stderr, "vectors: index %zu out of range\n", index);
        exit(2);
      }
      size_t end = jsonSkipValue(text.data(), text.size(), i);
      if (k == index) return {text, {i, end - i}};
      i = end;
    }
  }
  size_t size() const {
    size_t n = 0, i = span.pos + 1;
    for (;;) {
      while (strchr(" \n\r\t,", text[i])) i++;
      if (text[i] == ']') return n;
      i = jsonSkipValue(text.data(), text.size(), i);
      n++;
    }
  }
  std::string str() const { return unescape(text, span); }
  std::string raw() const { return text.substr(span.pos, span.len); }
};

static Json loadVectors() {
  const char *paths[] = {"packages/protocol/test-vectors.json", "../packages/protocol/test-vectors.json",
                         "../../packages/protocol/test-vectors.json", "../../../packages/protocol/test-vectors.json"};
  for (const char *p : paths) {
    std::ifstream f(p, std::ios::binary);
    if (!f) continue;
    std::stringstream ss;
    ss << f.rdbuf();
    std::string text = ss.str();
    return {text, {0, text.size()}};
  }
  fprintf(stderr, "test-vectors.json not found (run from the repo root)\n");
  exit(2);
}

int main() {
  // SHA-256 (FIPS 180-2) and streaming in odd-sized chunks.
  CHECK(sha256Hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  CHECK(sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  CHECK(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq") ==
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  {
    std::string big(1000, 'x');
    for (size_t i = 0; i < big.size(); i++) big[i] = (char)(i * 31 + 7);
    Sha256 sha;
    for (size_t i = 0; i < big.size();) {
      size_t n = (i % 7) + 1;
      if (i + n > big.size()) n = big.size() - i;
      sha.update(big.data() + i, n);
      i += n;
    }
    uint8_t out[32];
    sha.finish(out);
    CHECK(hex(out, 32) == sha256Hex(big));
  }

  // HMAC-SHA256 (RFC 4231 cases 2 and 6: short key, key longer than the block size).
  CHECK(hmacHex("Jefe", "what do ya want for nothing?") ==
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  CHECK(hmacHex(std::string(131, '\xaa'), "Test Using Larger Than Block-Size Key - Hash Key First") ==
        "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54");

  // base64 padding.
  const uint8_t b[] = {'f', 'o', 'o', 'b', 'a', 'r'};
  CHECK(base64(b, 0) == "");
  CHECK(base64(b, 1) == "Zg==");
  CHECK(base64(b, 2) == "Zm8=");
  CHECK(base64(b, 6) == "Zm9vYmFy");

  // Shared vectors.
  Json v = loadVectors();
  std::string secret = v.get("secret").str();
  CHECK(hmacBase64(secret, "hello", 5) == v.get("plain").get("hmac").str());
  CHECK(v.get("plain").get("data").str() == "hello");

  Json hs = v.get("handshake");
  std::string keyId = hs.get("keyId").str();
  uint32_t ts = (uint32_t)std::stoul(hs.get("ts").raw());
  CHECK(handshakeSignature(secret, keyId.c_str(), ts) == hs.get("signature").str());

  Json pin = v.get("localPin");
  CHECK(localPinVerifier(secret, pin.get("pin").str().c_str()) == pin.get("verifier").str());
  CHECK(localPinVerifier(secret, "246811") != pin.get("verifier").str());

  Json messages = v.get("messages");
  CHECK(messages.size() >= 4);
  for (size_t i = 0; i < messages.size(); i++) {
    Json m = messages.at(i);
    std::string msg = m.get("message").str();
    std::string raw = m.get("rawPayload").str();
    std::string mac = m.get("hmac").str();

    Span p;
    CHECK(extractRawPayload(msg.data(), msg.size(), p));
    CHECK(msg.substr(p.pos, p.len) == raw);
    CHECK(hmacBase64(secret, raw.data(), raw.size()) == mac);
    CHECK(encodeMessage(raw, secret) == msg);

    Span verified;
    CHECK(verifySignature(msg.data(), msg.size(), secret, verified));
    CHECK(verified.pos == p.pos && verified.len == p.len);
    CHECK(!verifySignature(msg.data(), msg.size(), secret + "x", verified));

    std::string tampered = msg;
    size_t at = tampered.find("dev_0001");
    tampered[at + 7] = '2';
    CHECK(!verifySignature(tampered.data(), tampered.size(), secret, verified));
  }

  // Scanner edge cases.
  {
    Span s;
    const std::string spaced = " { \"a\" : [1,{\"payload\":2}] ,\n \"payload\" : { \"x\" : \"}\\\"\" } } ";
    CHECK(extractRawPayload(spaced.data(), spaced.size(), s));
    CHECK(spaced.substr(s.pos, s.len) == "{ \"x\" : \"}\\\"\" }");
    const std::string notObject = "{\"payload\":\"str\"}";
    CHECK(!extractRawPayload(notObject.data(), notObject.size(), s));
    const std::string missing = "{\"header\":{}}";
    CHECK(!extractRawPayload(missing.data(), missing.size(), s));
    const std::string truncated = "{\"payload\":{\"a\":1";
    CHECK(!extractRawPayload(truncated.data(), truncated.size(), s));
    const std::string noSig = "{\"payload\":{}}";
    CHECK(!verifySignature(noSig.data(), noSig.size(), secret, s));
  }

  // Freshness window and replay guard.
  CHECK(isFresh(1000, 1060));
  CHECK(!isFresh(1000, 1061));
  CHECK(isFresh(1060, 1000));
  CHECK(!isFresh(1061, 1000));
  {
    ReplayGuard g;
    CHECK(g.accept("request", "rt-1", 1000));
    CHECK(!g.accept("request", "rt-1", 1001));
    CHECK(g.accept("response", "rt-1", 1001));
    CHECK(g.accept("request", "rt-1", 1000 + 2 * VOLTIX_REPLAY_WINDOW_S + 1));
  }

  // Local page: host names and PIN lockout.
  CHECK(localHostAllowed("192.168.1.23", "192.168.1.23", "voltix-a1b2"));
  CHECK(localHostAllowed("192.168.1.23:80", "192.168.1.23", "voltix-a1b2"));
  CHECK(localHostAllowed("Voltix-A1B2.local", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed("evil.example", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed("192.168.1.2", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed("voltix-a1b2.local.evil.example", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed("voltix-a1b2.localx", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed("", "192.168.1.23", "voltix-a1b2"));
  CHECK(!localHostAllowed(".local", "0.0.0.0", ""));
  {
    PinLockout l;
    uint32_t t = 0xFFFFF000UL;  // close to millis() wrap-around
    for (int i = 0; i < 4; i++) l.failed(t);
    CHECK(!l.locked(t));
    l.failed(t);
    CHECK(l.locked(t) && l.locked(t + PinLockout::kLockMs - 1));
    CHECK(l.secondsLeft(t) == 301);
    CHECK(!l.locked(t + PinLockout::kLockMs));
    l.failed(t + PinLockout::kLockMs);  // after the lock: five fresh tries
    CHECK(!l.locked(t + PinLockout::kLockMs));
    l.succeeded();
    for (int i = 0; i < 4; i++) l.failed(t);
    CHECK(!l.locked(t));
  }

  printf("%d/%d checks passed\n", checks - failures, checks);
  return failures ? 1 : 0;
}
