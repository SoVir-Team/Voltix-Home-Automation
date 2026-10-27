'use client';

import { clsx } from 'clsx';
import { Lock, LockOpen, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { Icon } from '@/components/icon';
import { Toggle } from '@/components/ui/toggle';
import { hasCap, isOn, stateSummary } from '@/lib/format';
import { useDeviceAction } from '@/lib/queries';
import type { Device } from '@/lib/types';

/** Device illustration: the template icon on a soft cyan glow that brightens when the device is on. */
export function DeviceVisual({ device, size = 'md' }: { device: Device; size?: 'md' | 'lg' }) {
  const on = isOn(device) || device.state.lockState === 'UNLOCKED' || device.state.contact === 'open';
  const lg = size === 'lg';
  return (
    <div className={clsx('relative grid place-items-center', lg ? 'size-56' : 'size-24')}>
      <div
        className={clsx(
          'absolute inset-0 rounded-full blur-2xl transition-opacity duration-500',
          on ? 'bg-brand-300/70 opacity-100' : 'bg-brand-100 opacity-60',
        )}
      />
      <div
        className={clsx(
          'relative grid place-items-center rounded-full bg-gradient-to-br from-white to-brand-50 shadow-card',
          lg ? 'size-36' : 'size-16',
        )}
      >
        <Icon
          name={device.icon}
          className={clsx(
            'transition-colors',
            lg ? 'size-16' : 'size-8',
            on ? 'text-brand-500' : 'text-subtle',
          )}
          strokeWidth={1.6}
        />
      </div>
    </div>
  );
}

export function DeviceCard({ device, roomName }: { device: Device; roomName?: string }) {
  const act = useDeviceAction(device);
  const offline = !!device.controllerId && !device.online;
  const isLock = hasCap(device, 'lock');
  const locked = device.state.lockState === 'LOCKED';

  return (
    <Link
      href={`/devices/${device.id}`}
      className={clsx(
        'group relative flex min-h-52 flex-col rounded-card bg-surface p-4 shadow-card transition sm:p-5',
        'hover:ring-2 hover:ring-brand-200 active:scale-[0.98]',
      )}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="truncate text-muted text-sm">{roomName ?? 'No room'}</span>
        {hasCap(device, 'powerState') && (
          <Toggle
            size="sm"
            label={`Turn ${device.name} ${isOn(device) ? 'off' : 'on'}`}
            checked={isOn(device)}
            disabled={offline}
            onChange={(next) =>
              act.mutate({
                action: 'setPowerState',
                value: { state: next ? 'On' : 'Off' },
                optimistic: { powerState: next ? 'On' : 'Off' },
              })
            }
          />
        )}
        {isLock && (
          <button
            type="button"
            disabled={offline}
            aria-label={locked ? `Unlock ${device.name}` : `Lock ${device.name}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              act.mutate({
                action: 'setLockState',
                value: { state: locked ? 'unlock' : 'lock' },
                optimistic: { lockState: locked ? 'UNLOCKED' : 'LOCKED' },
              });
            }}
            className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-600 disabled:opacity-50"
          >
            {locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
          </button>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center py-2">
        <DeviceVisual device={device} />
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-bold leading-tight">{device.name}</h3>
        <p
          className={clsx('mt-0.5 truncate font-medium text-sm', offline ? 'text-subtle' : 'text-brand-600')}
        >
          {offline ? (
            <span className="inline-flex items-center gap-1">
              <WifiOff className="size-3.5" /> Offline
            </span>
          ) : (
            stateSummary(device)
          )}
        </p>
      </div>
    </Link>
  );
}
