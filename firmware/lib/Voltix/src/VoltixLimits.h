// Mirrors packages/protocol/src/limits.ts. Keep the two in sync.
#pragma once

#define VOLTIX_PAYLOAD_VERSION 2
#define VOLTIX_SIGNATURE_VERSION 1

// Messages whose createdAt is further than this from "now" are rejected (replay protection).
#define VOLTIX_REPLAY_WINDOW_S 60
// Max size of one device WebSocket frame.
#define VOLTIX_MAX_MESSAGE_BYTES (8 * 1024)

// Per-device state-event token bucket.
#define VOLTIX_EVENT_BURST 10
#define VOLTIX_EVENT_REFILL_PER_S 1
// Telemetry (sensor) events: at most one per metric per device in this interval.
#define VOLTIX_TELEMETRY_MIN_INTERVAL_S 10

// Max channels (devices) one board may expose.
#define VOLTIX_MAX_CHANNELS 32

// Reconnect backoff (jittered) between these bounds.
#define VOLTIX_BACKOFF_MIN_MS 1000
#define VOLTIX_BACKOFF_MAX_MS 60000
