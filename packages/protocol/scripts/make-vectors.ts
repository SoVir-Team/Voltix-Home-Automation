/**
 * Regenerates test-vectors.json: fixed messages + expected HMACs shared by the TS tests and the
 * firmware's native unit tests, so both sides provably sign the same bytes.
 */
import { writeFileSync } from 'node:fs';
import { encodeMessage, handshakeSignature, hmacBase64, localPinVerifier } from '../src/node';

const secret = 'test-secret-0123456789abcdef0123456789abcdef';
const base = { clientId: 'web', createdAt: 1767225600, deviceId: 'dev_0001', replyToken: 'rt-0001' };

const messages = [
  encodeMessage({ ...base, action: 'setPowerState', type: 'request', value: { state: 'On' } }, secret),
  encodeMessage(
    {
      ...base,
      action: 'setPowerLevel',
      type: 'response',
      value: { powerLevel: 40 },
      success: true,
      message: 'OK',
    },
    secret,
  ),
  encodeMessage(
    {
      ...base,
      clientId: 'physical',
      action: 'setPowerState',
      type: 'event',
      value: { state: 'Off' },
      cause: { type: 'PHYSICAL_INTERACTION' },
    },
    secret,
  ),
  // unicode + escapes inside string values must not confuse the raw-payload scanner
  encodeMessage(
    { ...base, action: 'setMode', type: 'request', value: { mode: 'Ouvrir "porte" \\ é ✓ }' } },
    secret,
  ),
];

const vectors = {
  secret,
  messages: messages.map((m) => {
    const raw = JSON.parse(m).payload;
    return { message: m, rawPayload: JSON.stringify(raw), hmac: JSON.parse(m).signature.HMAC };
  }),
  handshake: {
    keyId: 'vxc_test',
    ts: 1767225600,
    signature: handshakeSignature(secret, 'vxc_test', 1767225600),
  },
  plain: { data: 'hello', hmac: hmacBase64(secret, 'hello') },
  localPin: { pin: '246810', verifier: localPinVerifier(secret, '246810') },
};

writeFileSync(new URL('../test-vectors.json', import.meta.url), `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${vectors.messages.length} message vectors`);
