/** Node-only helpers: signing and verifying device messages (uses node:crypto). */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { type Envelope, envelopeSchema, type Payload } from './envelope';
import { PAYLOAD_VERSION, REPLAY_WINDOW_S, SIGNATURE_VERSION } from './limits';
import { extractRawPayload } from './raw-payload';

export * from './index';

export function hmacBase64(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Serialise and sign a payload into a wire message. */
export function encodeMessage(payload: Payload, secret: string): string {
  const raw = JSON.stringify(payload);
  const sig = hmacBase64(secret, raw);
  return `{"header":{"payloadVersion":${PAYLOAD_VERSION},"signatureVersion":${SIGNATURE_VERSION}},"payload":${raw},"signature":{"HMAC":"${sig}"}}`;
}

export function newPayload(
  p: Omit<Payload, 'createdAt' | 'replyToken'> & Partial<Pick<Payload, 'createdAt' | 'replyToken'>>,
): Payload {
  return { createdAt: Math.floor(Date.now() / 1000), replyToken: randomUUID(), ...p };
}

export type DecodeError = 'malformed' | 'bad_signature' | 'stale' | 'schema';
export type DecodeResult = { ok: true; envelope: Envelope } | { ok: false; error: DecodeError };

/** Parse, verify signature over raw payload bytes, check replay window and schema. */
export function decodeMessage(
  message: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): DecodeResult {
  const raw = extractRawPayload(message);
  if (!raw) return { ok: false, error: 'malformed' };
  let json: unknown;
  try {
    json = JSON.parse(message);
  } catch {
    return { ok: false, error: 'malformed' };
  }
  const sig = (json as { signature?: { HMAC?: unknown } })?.signature?.HMAC;
  if (typeof sig !== 'string' || !safeEqual(sig, hmacBase64(secret, raw)))
    return { ok: false, error: 'bad_signature' };
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'schema' };
  if (Math.abs(nowS - parsed.data.payload.createdAt) > REPLAY_WINDOW_S) return { ok: false, error: 'stale' };
  return { ok: true, envelope: parsed.data };
}

/** Handshake signature: HMAC(secret, `${keyId}\n${ts}`). */
export function handshakeSignature(secret: string, keyId: string, ts: number): string {
  return hmacBase64(secret, `${keyId}\n${ts}`);
}
