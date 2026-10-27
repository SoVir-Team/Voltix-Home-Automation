/**
 * Applies ./migrations/*.sql in filename order, each in its own transaction, recording applied files
 * in schema_migrations. An advisory lock makes concurrent runs safe.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { ensurePartitions } from './partitions';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export async function migrate(url: string, log: (msg: string) => void = console.log): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(727001)`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(MIGRATIONS_DIR + file, 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      log(`applied ${file}`);
    }
    await ensurePartitions(sql, new Date());
  } finally {
    await sql`SELECT pg_advisory_unlock(727001)`.catch(() => {});
    await sql.end();
  }
}
