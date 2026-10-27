import { describe, expect, it } from 'vitest';
import { inTimeWindow, localTime, nextRun } from '../src/modules/automations/schedule';
import { levelFactor, localDate, splitByLocalDay } from '../src/modules/energy/energy';

const IST = { timezone: 'Asia/Kolkata', latitude: 12.97, longitude: 77.59 }; // Bengaluru

describe('schedules (pure)', () => {
  it('cron runs in the home time zone', () => {
    const now = new Date('2026-10-27T00:00:00Z'); // 05:30 IST
    const r = nextRun({ kind: 'time', cron: '0 7 * * *' }, IST, now)!;
    expect(r.at.toISOString()).toBe('2026-10-27T01:30:00.000Z'); // 07:00 IST
  });

  it('window triggers alternate start and end edges, including overnight windows', () => {
    const w = { kind: 'window' as const, start: '22:00', end: '06:00' };
    const at2100 = localTime('2026-10-27', '21:00', 'Asia/Kolkata');
    const start = nextRun(w, IST, at2100)!;
    expect(start.edge).toBe('start');
    expect(localDate(start.at, 'Asia/Kolkata')).toBe('2026-10-27');
    const end = nextRun(w, IST, start.at)!;
    expect(end.edge).toBe('end');
    expect(end.at.getTime() - start.at.getTime()).toBe(8 * 3600_000);
  });

  it('window respects selected weekdays', () => {
    // 2026-10-27 is a Tuesday (2). Only Fridays (5):
    const r = nextRun(
      { kind: 'window', start: '18:00', end: '19:00', days: [5] },
      IST,
      new Date('2026-10-27T00:00:00Z'),
    )!;
    expect(localDate(r.at, 'Asia/Kolkata')).toBe('2026-10-30');
  });

  it('sun triggers need a location and apply the offset', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    expect(
      nextRun(
        { kind: 'sun', event: 'sunset', offsetMin: 0 },
        { ...IST, latitude: null, longitude: null },
        now,
      ),
    ).toBeNull();
    const plain = nextRun({ kind: 'sun', event: 'sunset', offsetMin: 0 }, IST, now)!;
    const early = nextRun({ kind: 'sun', event: 'sunset', offsetMin: -30 }, IST, now)!;
    expect(plain.at.getTime() - early.at.getTime()).toBe(30 * 60_000);
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(plain.at),
    );
    expect(hour).toBeGreaterThanOrEqual(17);
    expect(hour).toBeLessThanOrEqual(18);
  });

  it('once triggers only fire in the future', () => {
    const now = new Date('2026-10-27T00:00:00Z');
    expect(nextRun({ kind: 'once', at: '2026-10-26T00:00:00Z' }, IST, now)).toBeNull();
    expect(nextRun({ kind: 'once', at: '2026-10-28T00:00:00Z' }, IST, now)?.at.toISOString()).toBe(
      '2026-10-28T00:00:00.000Z',
    );
  });

  it('time windows wrap past midnight', () => {
    const at = (hhmm: string) => localTime('2026-10-27', hhmm, 'Asia/Kolkata');
    expect(inTimeWindow(at('23:30'), 'Asia/Kolkata', '22:00', '06:00')).toBe(true);
    expect(inTimeWindow(at('05:59'), 'Asia/Kolkata', '22:00', '06:00')).toBe(true);
    expect(inTimeWindow(at('06:00'), 'Asia/Kolkata', '22:00', '06:00')).toBe(false);
    expect(inTimeWindow(at('12:00'), 'Asia/Kolkata', '09:00', '17:00')).toBe(true);
  });

  it('DST: local 09:00 in New York maps to the right instant on both sides of the change', () => {
    expect(localTime('2026-03-07', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-03-07T14:00:00.000Z',
    );
    expect(localTime('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-03-09T13:00:00.000Z',
    );
  });
});

describe('energy maths (pure)', () => {
  it('splits an on-interval at local midnight', () => {
    const from = localTime('2026-10-27', '23:00', 'Asia/Kolkata');
    const to = localTime('2026-10-28', '01:30', 'Asia/Kolkata');
    expect(splitByLocalDay(from, to, 'Asia/Kolkata')).toEqual([
      { day: '2026-10-27', seconds: 3600 },
      { day: '2026-10-28', seconds: 5400 },
    ]);
  });

  it('scales by level with a 10% floor', () => {
    expect(levelFactor({})).toBe(1);
    expect(levelFactor({ powerLevel: 50 })).toBe(0.5);
    expect(levelFactor({ brightness: 0 })).toBe(0.1);
  });
});
