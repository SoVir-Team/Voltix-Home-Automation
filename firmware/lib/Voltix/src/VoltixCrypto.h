// Portable SHA-256, HMAC-SHA256 and base64. No Arduino or mbedtls dependency, so the native unit tests
// exercise exactly the code that ships on the board.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace voltix {

class Sha256 {
 public:
  Sha256() { reset(); }
  void reset();
  void update(const void *data, size_t len);
  void finish(uint8_t out[32]);

 private:
  void block(const uint8_t *p);
  uint32_t h_[8];
  uint8_t buf_[64];
  size_t bufLen_;
  uint64_t total_;
};

void hmacSha256(const void *key, size_t keyLen, const void *data, size_t len, uint8_t out[32]);
std::string base64(const uint8_t *data, size_t len);
std::string hex(const uint8_t *data, size_t len);
// Compares without an early exit, so timing does not leak how many leading bytes matched.
bool constantTimeEquals(const char *a, size_t aLen, const char *b, size_t bLen);

}  // namespace voltix
