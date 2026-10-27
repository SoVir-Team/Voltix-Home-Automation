import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const VERSION = 1;

/** AES-256-GCM. Output: [version(1) | iv(12) | tag(16) | ciphertext]. */
export function encryptSecret(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptSecret(blob: Buffer, key: Buffer): string {
  if (blob[0] !== VERSION) throw new Error('unknown secret encryption version');
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
}
