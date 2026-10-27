// Local control on the home Wi-Fi, for when the internet (or the Voltix cloud) is down. The board serves one
// small page on port 80, at http://voltix-xxxx.local and at its LAN IP, protected by the home PIN set in the
// Voltix app. The board only keeps HMAC(boardSecret, "local-pin:" + PIN), never the PIN itself.
#pragma once

#include <Arduino.h>
#include <WebServer.h>

#include <string>

#include "VoltixProtocol.h"

class VoltixLocal {
 public:
  void begin(const char *hostName) { strlcpy(host_, hostName, sizeof host_); }
  // Call every loop(): starts the page once Wi-Fi is up and the setup portal (also port 80) is closed.
  void loop(bool wifiUp, bool portalOpen);
  // Empty verifier = local control off. Any change signs everyone out.
  void setPin(const char *secret, const char *verifier);
  // mDNS host name without ".local", e.g. "voltix-a1b2".
  const char *hostName() const { return host_; }

 private:
  void start();
  void stop();
  bool allowed(bool post);
  bool signedIn();
  void reply(int code, const String &json);
  void fail(int code, const char *message);
  void handlePage();
  void handleLogin();
  void handleState();
  void handleChannel();
  void handlePeers();
  void servicePeers();

  WebServer server_{80};
  bool running_ = false;
  char host_[24] = "";
  std::string secret_, verifier_;
  voltix::PinLockout lockout_;
  static const uint8_t kSessions = 8;
  char sessions_[kSessions][33] = {};
  uint8_t nextSession_ = 0;
  String peers_ = "[]";
  uint32_t peersAt_ = 0;
  void *search_ = nullptr;  // running mDNS query (mdns_search_once_t)
};
