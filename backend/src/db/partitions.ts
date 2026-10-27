import type { Sql } from 'postgres';

/** Retention (days) for partitioned history tables. */
export const RETENTION = { deviceEventsDays: 90, sensorReadingsDays: 30 } as const;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const iso = (d: Date) => d.toISOString();
const utcDay = (d: Date, add = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add));
const utcMonth = (d: Date, add = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));

/**
 * Create upcoming partitions (sensor readings: 7 days ahead, daily; device events: 2 months ahead,
 * monthly) and drop partitions past retention. Idempotent; safe to run at boot and daily.
 */
export async function ensurePartitions(sql: Sql, now: Date): Promise<{ created: number; dropped: number }> {
  let created = 0;
  let dropped = 0;
  const create = async (table: string, name: string, from: Date, to: Date) => {
    const exists = await sql`SELECT 1 FROM pg_class WHERE relname = ${name}`;
    if (exists.length) return;
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table} FOR VALUES FROM ('${iso(from)}') TO ('${iso(to)}')`,
    );
    created++;
  };

  for (let i = -1; i <= 7; i++) {
    const from = utcDay(now, i);
    await create('sensor_readings', `sensor_readings_${ymd(from)}`, from, utcDay(now, i + 1));
  }
  for (let i = -1; i <= 2; i++) {
    const from = utcMonth(now, i);
    await create('device_events', `device_events_${ymd(from).slice(0, 6)}`, from, utcMonth(now, i + 1));
  }

  const parts = await sql<{ parent: string; child: string }[]>`
    SELECT p.relname AS parent, c.relname AS child
    FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname IN ('sensor_readings', 'device_events')`;
  const sensorCutoff = ymd(utcDay(now, -RETENTION.sensorReadingsDays));
  const eventCutoff = ymd(utcMonth(new Date(now.getTime() - RETENTION.deviceEventsDays * 86_400_000))).slice(
    0,
    6,
  );
  for (const { parent, child } of parts) {
    const suffix = child.slice(parent.length + 1);
    const expired = parent === 'sensor_readings' ? suffix < sensorCutoff : suffix < eventCutoff;
    if (expired && /^\d{6,8}$/.test(suffix)) {
      await sql.unsafe(`DROP TABLE IF EXISTS ${child}`);
      dropped++;
    }
  }
  return { created, dropped };
}
