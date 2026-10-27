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
// HMAC(secret, "local-pin:<pin>"): what the cloud sends as localPinHash, so the board never stores the PIN.
std::string localPinVerifier(const std::string &secret, const char *pin);

// The local page only answers to its own names (blocks DNS rebinding): "<ip>" or "<mdnsHost>.local",
// optionally with ":80", any letter case.
bool localHostAllowed(const char *host, const char *ip, const char *mdnsHost);

// Five wrong PINs lock the local page's login for five minutes (for everyone: a 6-digit PIN then takes
// years to guess). millis()-based, wrap-safe.
class PinLockout {
 public:
  static const uint8_t kMaxFails = 5;
  static const uint32_t kLockMs = 5UL * 60 * 1000;
  bool locked(uint32_t nowMs) const { return fails_ >= kMaxFails && nowMs - lockedAt_ < kLockMs; }
  uint32_t secondsLeft(uint32_t nowMs) const { return locked(nowMs) ? (kLockMs - (nowMs - lockedAt_)) / 1000 + 1 : 0; }
  void failed(uint32_t nowMs) {
    if (fails_ >= kMaxFails) fails_ = 0;  // an expired lock: five fresh tries
    if (++fails_ == kMaxFails) lockedAt_ = nowMs;
  }
  void succeeded() { fails_ = 0; }

 private:
  uint8_t fails_ = 0;
  uint32_t lockedAt_ = 0;
};

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
