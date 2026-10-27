import type { Device } from './types';

export const isOn = (d: Pick<Device, 'state'>) => d.state.powerState === 'On';
export const hasCap = (d: Pick<Device, 'capabilities'>, cap: string) => d.capabilities.includes(cap);

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86_400), 'day');
}

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "18:30" -> "6:30 PM" in the viewer's locale. */
export function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export const kwh = (n: number) =>
  n >= 100 ? Math.round(n).toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(
      n,
    );
  } catch {
    return `${n.toFixed(0)} ${currency}`;
  }
}

/** One-line description of what a device is doing, for cards and lists. */
export function stateSummary(d: Device): string {
  const s = d.state;
  if (!d.online && d.controllerId) return 'Offline';
  const parts: string[] = [];
  if (typeof s.lockState === 'string')
    return s.lockState === 'LOCKED' ? 'Locked' : s.lockState === 'UNLOCKED' ? 'Unlocked' : 'Jammed';
  if (typeof s.contact === 'string') return s.contact === 'open' ? 'Open' : 'Closed';
  if (typeof s.motion === 'string') return s.motion === 'detected' ? 'Motion detected' : 'No motion';
  if (typeof s.mode === 'string') parts.push(s.mode);
  if (typeof s.thermostatMode === 'string' && s.powerState !== 'Off') parts.push(titleCase(s.thermostatMode));
  if (typeof s.targetTemperature === 'number' && s.powerState !== 'Off')
    parts.push(`Set ${s.targetTemperature}°`);
  if (typeof s.temperature === 'number') parts.push(`${s.temperature.toFixed(1)}°C`);
  if (typeof s.humidity === 'number') parts.push(`${Math.round(s.humidity)}%`);
  if (typeof s.power === 'number') parts.push(`${Math.round(s.power)} W`);
  if (typeof s.pm25 === 'number') parts.push(`PM2.5 ${Math.round(s.pm25)}`);
  if (s.powerState === 'On') {
    if (typeof s.brightness === 'number') parts.push(`${s.brightness}%`);
    else if (typeof s.powerLevel === 'number') parts.push(`Speed ${s.powerLevel}%`);
    else if (typeof s.rangeValue === 'number') parts.push(`${s.rangeValue}% open`);
  }
  if (!parts.length && d.capabilities.includes('powerState'))
    parts.push(s.powerState === 'On' ? 'On' : 'Off');
  return parts.join(' · ') || 'Ready';
}

export const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Only follow same-site paths after sign-in. Parse instead of pattern-matching: URL parsers drop tabs and
 * newlines, so "/\t/evil.com" becomes //evil.com (as do //evil.com and /\evil.com).
 */
export function safeNext(next: string | null): string {
  if (!next?.startsWith('/')) return '/';
  const base = 'https://voltix.invalid';
  const url = new URL(next, base);
  return url.origin === base ? url.pathname + url.search + url.hash : '/';
}
