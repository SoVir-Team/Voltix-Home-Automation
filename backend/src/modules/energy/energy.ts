import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** "YYYY-MM-DD" of instant `d` in time zone `tz`. */
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** UTC offset of `tz` at instant `d`, in ms (e.g. +05:30 -> 19_800_000). */
export function tzOffsetMs(d: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ?? '');
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/** Instant of the next local midnight strictly after `d` in `tz`. */
export function nextLocalMidnight(d: Date, tz: string): Date {
  const [y, m, day] = localDate(d, tz).split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, day + 1);
  return new Date(naive - tzOffsetMs(new Date(naive), tz));
}

/** Split [from, to) into per-local-day pieces. */
export function splitByLocalDay(from: Date, to: Date, tz: string): { day: string; seconds: number }[] {
  const out: { day: string; seconds: number }[] = [];
  let start = from;
  while (start < to) {
    const boundary = nextLocalMidnight(start, tz);
    const end = boundary < to ? boundary : to;
    out.push({ day: localDate(start, tz), seconds: (end.getTime() - start.getTime()) / 1000 });
    start = end;
  }
  return out;
}

/** Share of rated power drawn at the current level (fans/dimmers/lights). */
export function levelFactor(state: Record<string, unknown>): number {
  const level =
    typeof state.powerLevel === 'number'
      ? state.powerLevel
      : typeof state.brightness === 'number'
        ? state.brightness
        : 100;
  return Math.max(10, Math.min(100, level)) / 100;
}

/** Add estimated energy for an "on" interval, split across local days. */
export async function accrue(
  tx: Tx | Db,
  deviceId: string,
  tz: string,
  from: Date,
  to: Date,
  watts: number,
  factor: number,
): Promise<void> {
  if (to <= from || watts <= 0) return;
  for (const { day, seconds } of splitByLocalDay(from, to, tz)) {
    const wh = (watts * factor * seconds) / 3600;
    await tx.execute(sql`
      INSERT INTO energy_daily (device_id, day, on_seconds, wh_estimated)
      VALUES (${deviceId}, ${day}, ${Math.round(seconds)}, ${wh})
      ON CONFLICT (device_id, day) DO UPDATE
        SET on_seconds = energy_daily.on_seconds + excluded.on_seconds,
            wh_estimated = energy_daily.wh_estimated + excluded.wh_estimated`);
  }
}
