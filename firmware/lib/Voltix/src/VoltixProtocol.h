// Portable half of the device protocol: raw-payload extraction, signing, verification, replay guard.
// Mirrors packages/protocol/src/{raw-payload,node}.ts. Signatures cover the exact payload bytes on the
// wire, so neither side ever re-serialises JSON before checking them.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

#include "VoltixLimits.h"

namespace voltix {

struct Span {
  size_t pos = 0;
  size_t len = 0;
};

// Index just past the JSON value starting at s[i], or SIZE_MAX if it is malformed or truncated.
size_t jsonSkipValue(const char *s, size_t n, size_t i);
// Span of the value of top-level member `key` of the JSON object in s[0..n). False if absent or malformed.
bool jsonMember(const char *s, size_t n, const char *key, Span &out);
// Span of the top-level "payload" object. False if missing or not an object.
bool extractRawPayload(const char *s, size_t n, Span &out);

std::string hmacBase64(const std::string &secret, const char *data, size_t len);
// Wraps an already-serialised payload object into a signed wire message.
std::string encodeMessage(const std::string &rawPayload, const std::string &secret);
// Checks signature.HMAC against the raw payload bytes; on success `payload` spans the payload object.
bool verifySignature(const char *msg, size_t n, const std::string &secret, Span &payload);
// HMAC(secret, "<keyId>\n<ts>") for the x-voltix-sig handshake header.
std::string handshakeSignature(const std::string &secret, const char *keyId, uint32_t ts);

inline bool isFresh(int64_t createdAt, int64_t now) {
  int64_t d = now - createdAt;
  return d <= VOLTIX_REPLAY_WINDOW_S && d >= -VOLTIX_REPLAY_WINDOW_S;
}

// Remembers recently accepted type:replyToken pairs so a captured message can't be replayed inside the
// freshness window. Fixed size: with the server's message rate, 64 entries cover far more than 60 s.
class ReplayGuard {
 public:
  // True the first time a pair is seen within the window; false for a replay.
  bool accept(const char *type, const char *replyToken, uint32_t now);

 private:
  static const int kSize = 64;
  uint64_t hash_[kSize] = {0};
  uint32_t expires_[kSize] = {0};
  int next_ = 0;
};

}  // namespace voltix
