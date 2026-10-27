/**
 * DEV ONLY: provisions a load-test fleet straight into the database (the API's rate limits would make
 * 3,000 boards take ten minutes) and writes its credentials for tools/device-sim/src/load.ts.
 * Re-running replaces the previous fleet.
 *
 *   npx tsx --env-file=backend/.env backend/src/db/seed-load.ts [--homes 150] [--boards 20] [--out <file>]
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { eq, inArray } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { encryptSecret, randomToken, sha256 } from '../lib/crypto';
import { createDb } from './client';
import { apiKeys, controllers, homeMembers, homes, users } from './schema';

const { values } = parseArgs({
  options: {
    homes: { type: 'string', default: '150' },
    boards: { type: 'string', default: '20' },
    out: { type: 'string', default: 'tools/device-sim/.load/fleet.json' },
  },
});
const homeCount = Number(values.homes);
const boardsPerHome = Number(values.boards);

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  console.error('seed-load is for development databases only');
  process.exit(1);
}
const encKey = Buffer.from(env.SECRET_ENC_KEY, 'base64');
const { db, sql } = createDb(env.DATABASE_URL, { max: 4 });
const email = 'load@voltix.test';

// Replace the previous fleet: its homes cascade to boards, devices and history.
const [old] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
if (old) {
  const owned = await db
    .select({ id: homeMembers.homeId })
    .from(homeMembers)
    .where(eq(homeMembers.userId, old.id));
  if (owned.length)
    await db.delete(homes).where(
      inArray(
        homes.id,
        owned.map((h) => h.id),
      ),
    );
  await db.delete(users).where(eq(users.id, old.id));
}

const [user] = await db
  .insert(users)
  .values({
    email,
    name: 'Load test',
    passwordHash: `!disabled-${randomToken(16)}`,
    emailVerifiedAt: new Date(),
  })
  .returning();
const homeRows = await db
  .insert(homes)
  .values(Array.from({ length: homeCount }, (_, i) => ({ name: `Load home ${i + 1}`, createdBy: user!.id })))
  .returning({ id: homes.id });
await db
  .insert(homeMembers)
  .values(homeRows.map((h) => ({ homeId: h.id, userId: user!.id, role: 'owner' as const })));

const boards: { keyId: string; secret: string; homeId: string }[] = [];
for (const h of homeRows) {
  for (let i = 0; i < boardsPerHome; i++) {
    boards.push({ keyId: `vxc_${randomBytes(10).toString('hex')}`, secret: randomToken(32), homeId: h.id });
  }
}
for (let i = 0; i < boards.length; i += 500) {
  await db.insert(controllers).values(
    boards.slice(i, i + 500).map((b, j) => ({
      homeId: b.homeId,
      name: `Load board ${i + j + 1}`,
      keyId: b.keyId,
      secretEnc: encryptSecret(b.secret, encKey),
    })),
  );
}

const prefix = Array.from(randomBytes(8), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const apiKey = `vx_${prefix}_${randomToken(32)}`;
await db.insert(apiKeys).values({
  userId: user!.id,
  name: 'load test',
  prefix,
  keyHash: sha256(apiKey),
  scopes: ['devices:read', 'devices:control'],
});

mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify({ apiKey, boards }, null, 1));
console.log(`${homeCount} homes, ${boards.length} boards -> ${values.out}`);
await sql.end();
