import { CronExpressionParser } from 'cron-parser';
import * as SunCalc from 'suncalc';
import { localDate, tzOffsetMs } from '../energy/energy';
import type { Trigger } from './automation.schema';

export interface HomeGeo {
  timezone: string;
  latitude: number | null;
  longitude: number | null;
}

/** Local wall-clock time `HH:MM` on local date `ymd` in `tz`, as an instant. */
export function localTime(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(naive - tzOffsetMs(new Date(naive), tz));
}

/** Day of week (0 = Sunday) of a local date string. */
export const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface NextRun {
  at: Date;
  /** For window triggers: which edge this run is. */
  edge?: 'start' | 'end';
}

/** Next time a scheduled trigger fires strictly after `now`, or null (device triggers / expired timers). */
export function nextRun(trigger: Trigger, home: HomeGeo, now: Date): NextRun | null {
  const tz = home.timezone;
  switch (trigger.kind) {
    case 'time': {
      const it = CronExpressionParser.parse(trigger.cron, { currentDate: now, tz });
      return { at: it.next().toDate() };
    }
    case 'once': {
      const at = new Date(trigger.at);
      return at > now ? { at } : null;
    }
    case 'window': {
      const today = localDate(now, tz);
      for (let i = 0; i <= 8; i++) {
        const day = addDays(today, i);
        if (trigger.days && !trigger.days.includes(weekday(day))) continue;
        const edges: NextRun[] = [
          { at: localTime(day, trigger.start, tz), edge: 'start' as const },
          {
            at: localTime(trigger.end <= trigger.start ? addDays(day, 1) : day, trigger.end, tz),
            edge: 'end' as const,
          },
        ].filter((e) => e.at > now);
        edges.sort((a, b) => a.at.getTime() - b.at.getTime());
        if (edges[0]) return edges[0];
      }
      return null;
    }
    case 'sun': {
      if (home.latitude == null || home.longitude == null) return null;
      const today = localDate(now, tz);
      for (let i = 0; i <= 8; i++) {
        const day = addDays(today, i);
        if (trigger.days && !trigger.days.includes(weekday(day))) continue;
        const noon = localTime(day, '12:00', tz);
        const t = SunCalc.getTimes(noon, home.latitude, home.longitude)[trigger.event];
        if (!t || Number.isNaN(t.getTime())) continue; // polar day/night
        const at = new Date(t.getTime() + trigger.offsetMin * 60_000);
        if (at > now) return { at };
      }
      return null;
    }
    case 'device':
      return null;
  }
}

/** Is local time-of-day of `now` within [from, to) (wrapping past midnight allowed)? */
export function inTimeWindow(now: Date, tz: string, from: string, to: string): boolean {
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}
