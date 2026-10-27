import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string) => hash(password, OPTS);

export async function verifyPassword(hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}

/** A real hash of a random string, so unknown-email logins take as long as wrong-password ones. */
let dummyHash: Promise<string> | undefined;
export const timingSafeDummyVerify = async (password: string) => {
  dummyHash ??= hash('voltix-dummy-password-for-timing', OPTS);
  await verifyPassword(await dummyHash, password);
};

const COMMON = new Set([
  'password123',
  'password1234',
  '1234567890',
  '12345678910',
  'qwertyuiop',
  'iloveyou123',
  'admin12345',
  'welcome123',
  'letmein1234',
  'abcdefghij',
  'voltix1234',
  'password@123',
]);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters')
  .refine((p) => !COMMON.has(p.toLowerCase()), 'This password is too common');
