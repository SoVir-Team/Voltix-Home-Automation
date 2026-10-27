import { watchKeysFor } from './device-ops';
import { formatDateTime, hhmmLabel } from './format';
import type { Automation, Device, Trigger } from './types';

export type AutomationTab = 'schedules' | 'timers' | 'rules';

export function tabOf(t: Trigger): AutomationTab {
  if (t.kind === 'once') return 'timers';
  if (t.kind === 'device') return 'rules';
  return 'schedules';
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function daysLabel(days?: number[]): string {
  if (!days || days.length === 7) return 'Every day';
  const s = [...days].sort().join(',');
  if (s === '1,2,3,4,5') return 'Weekdays';
  if (s === '0,6') return 'Weekends';
  return days
    .slice()
    .sort()
    .map((d) => dayNames[d])
    .join(', ');
}

/** The UI only builds simple daily cron ("m h * * days"); anything else is shown raw. */
export function parseDailyCron(cron: string): { time: string; days: number[] } | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(cron.trim());
  if (!m) return null;
  const days = m[3] === '*' ? [0, 1, 2, 3, 4, 5, 6] : m[3]!.split(',').map(Number);
  return { time: `${m[2]!.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`, days };
}

export function dailyCron(time: string, days: number[]): string {
  const [h, m] = time.split(':').map(Number);
  const d = days.length === 7 ? '*' : [...days].sort().join(',');
  return `${m} ${h} * * ${d}`;
}

const opWords: Record<string, string> = {
  gt: 'above',
  gte: 'at or above',
  lt: 'below',
  lte: 'at or below',
  eq: 'is',
  neq: 'is not',
  changed: 'changes',
};

export function describeTrigger(t: Trigger, devices: Device[]): string {
  switch (t.kind) {
    case 'time': {
      const c = parseDailyCron(t.cron);
      return c ? `${daysLabel(c.days)} at ${hhmmLabel(c.time)}` : `Cron ${t.cron}`;
    }
    case 'sun': {
      const off = t.offsetMin ? ` ${t.offsetMin > 0 ? '+' : '−'}${Math.abs(t.offsetMin)} min` : '';
      return `${daysLabel(t.days)} at ${t.event}${off}`;
    }
    case 'window':
      return `${daysLabel(t.days)}, ${hhmmLabel(t.start)} – ${hhmmLabel(t.end)}`;
    case 'once':
      return formatDateTime(t.at);
    case 'device': {
      const d = devices.find((x) => x.id === t.deviceId);
      if (!d) return 'When a removed device changes';
      const k = watchKeysFor(d).find((x) => x.key === t.key);
      if (k?.changed) return `When ${d.name} ${k.label.toLowerCase().replace(/^doorbell /, '')}`;
      const choice = k?.choices?.find((c) => c.value === String(t.value));
      if (choice) return `When ${d.name} ${choice.label}`;
      return `When ${d.name} ${k?.label.toLowerCase() ?? t.key} ${opWords[t.op]} ${t.value ?? ''}${k?.unit ?? ''}`;
    }
  }
}

/** Sort: enabled first, then by next run. */
export function sortAutomations(list: Automation[]) {
  return [...list].sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) ||
      (a.nextRunAt ?? '9').localeCompare(b.nextRunAt ?? '9') ||
      a.name.localeCompare(b.name),
  );
}
