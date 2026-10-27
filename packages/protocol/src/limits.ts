/** Shared protocol constants. Firmware mirrors these in firmware/lib/Voltix/src/VoltixLimits.h. */
export const PAYLOAD_VERSION = 2;
export const SIGNATURE_VERSION = 1;

/** Messages whose createdAt is further than this from "now" are rejected (replay protection). */
export const REPLAY_WINDOW_S = 60;
/** Max size of one device WebSocket frame. */
export const MAX_DEVICE_MESSAGE_BYTES = 8 * 1024;
/** Max size of one browser WebSocket frame. */
export const MAX_CLIENT_MESSAGE_BYTES = 4 * 1024;

/** How long the cloud waits for a device response before failing the command. */
export const COMMAND_TIMEOUT_MS = 8_000;
/** Server -> device ping interval; two missed pongs drop the socket. */
export const PING_INTERVAL_MS = 30_000;
/** A disconnected controller is only marked offline after this grace period (avoids flapping). */
export const OFFLINE_GRACE_MS = 10_000;

/** Per-device state-event token bucket. */
export const EVENT_BURST = 10;
export const EVENT_REFILL_PER_S = 1;
/** Telemetry (sensor) events: at most one per metric per device in this interval. */
export const TELEMETRY_MIN_INTERVAL_S = 10;

/** Max channels (devices) one controller board may expose. */
export const MAX_CHANNELS = 32;
