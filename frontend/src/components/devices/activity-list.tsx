'use client';

import { clsx } from 'clsx';
import { Activity } from 'lucide-react';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { formatDateTime, formatTime } from '@/lib/format';
import type { ActivityEvent } from '@/lib/types';

const sourceLabel: Record<string, string> = {
  app: 'from the app',
  api: 'via API',
  scene: 'by a scene',
  schedule: 'by a schedule',
  automation: 'by an automation',
  physical: 'at the switch',
  restore: 'after power returned',
  system: '',
};

/** Plain-English line for an event: "Turned on at the switch", "Brightness set to 40% by Asha". */
export function describe(e: ActivityEvent): string {
  if (e.kind === 'online') return 'Board came online';
  if (e.kind === 'offline') return 'Board went offline';
  const v = e.value ?? {};
  let what: string;
  switch (e.action) {
    case 'setPowerState':
      what = v.state === 'On' ? 'Turned on' : 'Turned off';
      break;
    case 'setBrightness':
      what = `Brightness ${v.brightness}%`;
      break;
    case 'setPowerLevel':
      what = `Level ${v.powerLevel}%`;
      break;
    case 'targetTemperature':
      what = `Set to ${v.temperature}°C`;
      break;
    case 'setThermostatMode':
      what = `Mode ${String(v.thermostatMode).toLowerCase()}`;
      break;
    case 'setLockState':
      what = String(v.state).toUpperCase().startsWith('LOCK') ? 'Locked' : 'Unlocked';
      break;
    case 'currentTemperature':
      what = `Temperature ${v.temperature}°C`;
      break;
    case 'DoorbellPress':
      what = 'Doorbell rang';
      break;
    case 'motion':
      what = v.state === 'detected' ? 'Motion detected' : 'Motion cleared';
      break;
    case 'setContactState':
      what = v.state === 'open' ? 'Opened' : 'Closed';
      break;
    default:
      what = e.action ?? 'Event';
  }
  if (e.success === false) return `${what} failed${e.message ? ` (${e.message})` : ''}`;
  const by = e.actorName && e.source === 'app' ? `by ${e.actorName}` : (sourceLabel[e.source] ?? '');
  return [what, by].filter(Boolean).join(' ');
}

export function ActivityList({
  events,
  loading,
  showDevice,
  highlightFirst,
}: {
  events?: ActivityEvent[];
  loading: boolean;
  showDevice?: boolean;
  highlightFirst?: boolean;
}) {
  if (loading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  if (!events?.length)
    return (
      <EmptyState icon={<Activity className="size-8" />} title="Nothing yet">
        Device activity will appear here.
      </EmptyState>
    );
  const today = new Date().toDateString();
  return (
    <ul className="space-y-3">
      {events.map((e, i) => (
        <li
          key={e.id}
          className={clsx(
            'flex items-center justify-between gap-4 rounded-[1.5rem] bg-surface px-5 py-4 shadow-card',
            highlightFirst && i === 0 && 'ring-2 ring-brand-400',
          )}
        >
          <div className="min-w-0">
            <div className={clsx('truncate', e.success === false && 'text-danger')}>{describe(e)}</div>
            {showDevice && e.deviceName && <div className="truncate text-muted text-sm">{e.deviceName}</div>}
          </div>
          <time className="shrink-0 text-muted text-sm" dateTime={e.at}>
            {new Date(e.at).toDateString() === today ? formatTime(e.at) : formatDateTime(e.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
