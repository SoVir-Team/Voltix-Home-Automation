import { describe, expect, it } from 'vitest';
import vectors from '../test-vectors.json';
import { capabilities, findAction, findEvent } from './capabilities';
import { parseChannelsHeader } from './envelope';
import { decodeMessage, encodeMessage, handshakeSignature, hmacBase64, newPayload } from './node';
import { extractRawPayload } from './raw-payload';
import { builtinTemplates } from './templates';

const { secret } = vectors;
const t0 = 1767225600;

describe('test vectors', () => {
  it.each(vectors.messages)('raw payload + HMAC match for vector %#', (v) => {
    expect(extractRawPayload(v.message)).toBe(v.rawPayload);
    expect(hmacBase64(secret, v.rawPayload)).toBe(v.hmac);
    expect(decodeMessage(v.message, secret, t0).ok).toBe(true);
  });

  it('handshake signature', () => {
    expect(handshakeSignature(secret, vectors.handshake.keyId, vectors.handshake.ts)).toBe(
      vectors.handshake.signature,
    );
  });
});

describe('decodeMessage', () => {
  const msg = encodeMessage(
    newPayload({
      action: 'setPowerState',
      clientId: 'web',
      deviceId: 'd1',
      type: 'request',
      value: { state: 'On' },
      createdAt: t0,
    }),
    secret,
  );

  it('rejects a tampered payload', () => {
    expect(decodeMessage(msg.replace('"On"', '"Off"'), secret, t0)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
  });

  it('rejects the wrong secret', () => {
    expect(decodeMessage(msg, 'other', t0)).toEqual({ ok: false, error: 'bad_signature' });
  });

  it('enforces the 60 s replay window on both sides', () => {
    expect(decodeMessage(msg, secret, t0 + 60).ok).toBe(true);
    expect(decodeMessage(msg, secret, t0 + 61)).toEqual({ ok: false, error: 'stale' });
    expect(decodeMessage(msg, secret, t0 - 61)).toEqual({ ok: false, error: 'stale' });
  });

  it('verifies raw bytes even when key order differs from JSON.stringify', () => {
    const raw = `{"value":{"state":"On"},"type":"request","action":"setPowerState","clientId":"x","createdAt":${t0},"deviceId":"d1","replyToken":"r"}`;
    const m = `{"header":{"payloadVersion":2,"signatureVersion":1},"signature":{"HMAC":"${hmacBase64(secret, raw)}"},"payload":${raw}}`;
    expect(decodeMessage(m, secret, t0).ok).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(decodeMessage('not json', secret, t0).ok).toBe(false);
    expect(decodeMessage('{"payload":"str"}', secret, t0).ok).toBe(false);
    expect(decodeMessage('{"payload":{"a":1}', secret, t0).ok).toBe(false);
  });
});

describe('extractRawPayload', () => {
  it('ignores a nested "payload" key', () => {
    expect(extractRawPayload('{"x":{"payload":{"a":1}},"payload":{"b":2}}')).toBe('{"b":2}');
  });
  it('handles braces and escaped quotes inside strings', () => {
    expect(extractRawPayload('{"payload":{"s":"}\\"{"}}')).toBe('{"s":"}\\"{"}');
  });
});

describe('parseChannelsHeader', () => {
  it('parses a valid declaration', () => {
    expect(parseChannelsHeader('1:switch, 5:fan')).toEqual([
      { channel: 1, type: 'switch' },
      { channel: 5, type: 'fan' },
    ]);
  });
  it('rejects duplicates and garbage', () => {
    expect(() => parseChannelsHeader('1:switch,1:fan')).toThrow();
    expect(() => parseChannelsHeader('0:switch')).toThrow();
    expect(() => parseChannelsHeader('1:sw itch')).toThrow();
  });
  it('allows channels 1..32 only, like the firmware', () => {
    expect(parseChannelsHeader('32:switch')).toEqual([{ channel: 32, type: 'switch' }]);
    expect(() => parseChannelsHeader('33:switch')).toThrow();
    expect(() => parseChannelsHeader('99:switch')).toThrow();
  });
});

describe('capabilities', () => {
  it('validates values and maps state', () => {
    const def = findAction(['powerState', 'powerLevel'], 'setPowerLevel')!;
    expect(def.value.safeParse({ powerLevel: 101 }).success).toBe(false);
    expect(def.state(def.value.parse({ powerLevel: 40 }))).toEqual({ powerLevel: 40 });
    expect(findAction(['powerState'], 'setPowerLevel')).toBeUndefined();
  });

  it('maps lock commands to lock state', () => {
    const def = findAction(['lock'], 'setLockState')!;
    expect(def.state({ state: 'lock' })).toEqual({ lockState: 'LOCKED' });
    expect(def.state({ state: 'UNLOCKED' })).toEqual({ lockState: 'UNLOCKED' });
  });

  it('extracts sensor readings', () => {
    const ev = findEvent(['temperatureSensor'], 'currentTemperature')!;
    expect(ev.readings!({ temperature: 21.5, humidity: 40 })).toEqual({ temperature: 21.5, humidity: 40 });
  });

  it('every built-in template uses known capabilities', () => {
    for (const t of builtinTemplates) for (const c of t.capabilities) expect(capabilities).toHaveProperty(c);
  });
});
