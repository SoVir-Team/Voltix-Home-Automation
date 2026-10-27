/** Creates the first platform admin from ADMIN_EMAIL / ADMIN_PASSWORD if it doesn't exist. Idempotent. */
import { eq } from 'drizzle-orm';
import { loadEnv } from '../config/env';
import { hashPassword } from '../modules/auth/password';
import { createDb } from './client';
import { homeMembers, homes, rooms, users } from './schema';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL, { max: 1 });

if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set; nothing to seed');
} else {
  const email = env.ADMIN_EMAIL.toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    await db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, existing.id));
    console.log(`admin ${email} already exists (ensured platform admin)`);
  } else {
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: 'Voltix Admin',
        passwordHash: await hashPassword(env.ADMIN_PASSWORD),
        isPlatformAdmin: true,
        emailVerifiedAt: new Date(),
      })
      .returning();
    const [home] = await db.insert(homes).values({ name: 'My Home', createdBy: user!.id }).returning();
    await db.insert(homeMembers).values({ homeId: home!.id, userId: user!.id, role: 'owner' });
    await db
      .insert(rooms)
      .values(
        ['Living Room', 'Kitchen', 'Bedroom'].map((name, i) => ({ homeId: home!.id, name, sortOrder: i })),
      );
    console.log(`created platform admin ${email}`);
  }
}
await sql.end();
