import { sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { ensurePartitions } from '../../db/partitions';
import { accrue, levelFactor } from '../energy/energy';
import { pumpRollouts, sweepOtaTimeouts } from '../ota/ota.service';

const LOCK_ID = 727002;

/** Periodic housekeeping: partitions, rollups, energy, retention, OTA pacing. Single-runner via advisory lock. */
export class Maintenance {
  private hourly?: NodeJS.Timeout;
  private minutely?: NodeJS.Timeout;

  constructor(private readonly ctx: AppContext) {}

  start(): void {
    void this.runHourly();
    this.hourly = setInterval(() => void this.runHourly(), 3600_000);
    this.minutely = setInterval(() => void this.runMinutely(), 60_000);
    this.hourly.unref();
    this.minutely.unref();
  }

  stop(): void {
    clearInterval(this.hourly);
    clearInterval(this.minutely);
  }

  private async locked(fn: () => Promise<void>): Promise<void> {
    // Session locks belong to one connection: take and release on the same reserved one, not the pool.
    // Never throws: callers fire and forget, and an unhandled rejection would stop the process.
    let conn: Awaited<ReturnType<typeof this.ctx.sql.reserve>> | undefined;
    try {
      conn = await this.ctx.sql.reserve();
      const [row] = await conn<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_ID}) AS ok`;
      if (!row?.ok) return;
      try {
        await fn();
      } finally {
        await conn`SELECT pg_advisory_unlock(${LOCK_ID})`;
      }
    } catch (err) {
      this.ctx.log.error({ err }, 'maintenance failed');
    } finally {
      conn?.release();
    }
  }

  async runMinutely(): Promise<void> {
    await this.locked(async () => {
      await sweepOtaTimeouts(this.ctx);
      await pumpRollouts(this.ctx);
    });
  }

  async runHourly(now = new Date()): Promise<void> {
    await this.locked(async () => {
      const parts = await ensurePartitions(this.ctx.sql, now);
      await this.rollupSensors();
      await this.closeEnergyIntervals(now);
      await this.retention();
      this.ctx.log.info(parts, 'hourly maintenance done');
    });
  }

  /** (Re)compute hourly min/avg/max for the last 3 hours. Idempotent. */
  async rollupSensors(): Promise<void> {
    await this.ctx.db.execute(sql`
      INSERT INTO sensor_rollups_hourly (device_id, metric, hour, min, max, avg, count)
      SELECT device_id, metric, date_trunc('hour', ts), min(value), max(value), avg(value), count(*)
      FROM sensor_readings
      WHERE ts >= date_trunc('hour', now()) - interval '3 hours'
      GROUP BY 1, 2, 3
      ON CONFLICT (device_id, metric, hour) DO UPDATE
        SET min = excluded.min, max = excluded.max, avg = excluded.avg, count = excluded.count`);
  }

  /** Book energy for devices that have been on for a while, so daily totals stay current. */
  async closeEnergyIntervals(now: Date): Promise<void> {
    // Raw sql templates take timestamps as ISO strings (the driver doesn't serialise Date there).
    const at = now.toISOString();
    const rows = await this.ctx.db.execute<{
      device_id: string;
      since: Date;
      state: Record<string, unknown>;
      config: { ratedWatts?: number };
      timezone: string;
    }>(sql`
      SELECT s.device_id, s.power_on_since AS since, s.state, d.config, h.timezone
      FROM device_state s JOIN devices d ON d.id = s.device_id JOIN homes h ON h.id = d.home_id
      WHERE s.power_on_since IS NOT NULL AND s.power_on_since < ${at}`);
    for (const r of rows) {
      await this.ctx.db.transaction(async (tx) => {
        // Lock the row like applyState does, and only book the interval if nobody changed it meanwhile.
        const [cur] = await tx.execute<{ since: Date | null; state: Record<string, unknown> }>(
          sql`SELECT power_on_since AS since, state FROM device_state WHERE device_id = ${r.device_id} FOR UPDATE`,
        );
        if (!cur?.since || new Date(cur.since).getTime() !== new Date(r.since).getTime()) return;
        const since = new Date(cur.since);
        await accrue(
          tx,
          r.device_id,
          r.timezone,
          since,
          now,
          r.config.ratedWatts ?? 0,
          levelFactor(cur.state),
        );
        await tx.execute(
          sql`UPDATE device_state SET power_on_since = ${at} WHERE device_id = ${r.device_id}`,
        );
      });
    }
  }

  async retention(): Promise<void> {
    await this.ctx.db.execute(sql`DELETE FROM sensor_rollups_hourly WHERE hour < now() - interval '2 years'`);
    await this.ctx.db.execute(sql`DELETE FROM automation_runs WHERE at < now() - interval '30 days'`);
    await this.ctx.db.execute(sql`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
    await this.ctx.db.execute(sql`DELETE FROM audit_log WHERE at < now() - interval '1 year'`);
    await this.ctx.db.execute(sql`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`);
    await this.ctx.db.execute(sql`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    await this.ctx.db.execute(sql`DELETE FROM home_invites WHERE expires_at < now() - interval '30 days'`);
  }
}
