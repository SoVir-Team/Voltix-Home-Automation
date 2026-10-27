'use client';

import { useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Thermometer } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Icon } from '@/components/icon';
import { Toggle } from '@/components/ui/toggle';
import { api, errorMessage } from '@/lib/api';
import { hasCap, isOn } from '@/lib/format';
import { qk } from '@/lib/queries';
import type { Device, Room } from '@/lib/types';

export function roomStats(devices: Device[]) {
  const switchable = devices.filter((d) => hasCap(d, 'powerState'));
  const active = switchable.filter(isOn).length;
  const temps = devices.map((d) => d.state.temperature).filter((t): t is number => typeof t === 'number');
  const temperature = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  return { switchable, active, total: devices.length, temperature };
}

/** Turn every switchable device in a room on or off (each device answers independently). */
export function useRoomPower(homeId: string) {
  const qc = useQueryClient();
  return async (devices: Device[], on: boolean) => {
    const targets = devices.filter((d) => hasCap(d, 'powerState') && (d.online || !d.controllerId));
    const state = on ? 'On' : 'Off';
    qc.setQueryData<Device[]>(qk.devices(homeId), (list) =>
      list?.map((d) =>
        targets.some((t) => t.id === d.id) ? { ...d, state: { ...d.state, powerState: state } } : d,
      ),
    );
    const results = await Promise.allSettled(
      targets.map((d) => api.post(`/devices/${d.id}/actions`, { action: 'setPowerState', value: { state } })),
    );
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length) {
      toast.error(`${failed.length} of ${targets.length} devices didn't respond`, {
        description: errorMessage(failed[0]!.reason),
      });
    }
    void qc.invalidateQueries({ queryKey: qk.devices(homeId) });
  };
}

/** White summary card used on the dashboard (name, power toggle, active count, temperature). */
export function RoomSummaryCard({
  room,
  devices,
  homeId,
}: {
  room: Room;
  devices: Device[];
  homeId: string;
}) {
  const s = roomStats(devices);
  const setPower = useRoomPower(homeId);
  return (
    <Link
      href={`/rooms/${room.id}`}
      className="flex min-h-44 flex-col justify-between rounded-card bg-surface p-5 shadow-card transition hover:ring-2 hover:ring-brand-200 active:scale-[0.98]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-xl leading-tight">{room.name}</h3>
        {s.switchable.length > 0 && (
          <Toggle
            label={`All devices in ${room.name}`}
            checked={s.active > 0}
            onChange={(on) => setPower(devices, on)}
          />
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-bold text-3xl">
            {s.active}/{s.switchable.length || s.total}
          </div>
          <div className="text-muted text-sm">Devices active</div>
        </div>
        {s.temperature !== null && (
          <div className="rounded-2xl bg-gradient-to-br from-white to-brand-50 px-3 py-2 text-sm shadow-card">
            <div className="flex items-center gap-1 font-semibold">
              <Thermometer className="size-4 text-brand-500" />
              {s.temperature.toFixed(0)}°C
            </div>
            <div className="text-muted text-xs">Temperature</div>
          </div>
        )}
      </div>
    </Link>
  );
}

const covers = [
  'from-[#1e3a5f] via-[#2b6c9e] to-[#5fb8e6]',
  'from-[#23395b] via-[#3d6f8e] to-[#8ecae6]',
  'from-[#1b2f4b] via-[#246a8f] to-[#3fbcec]',
  'from-[#2a3550] via-[#4f6d8a] to-[#9ac9e3]',
];

/** Large cover card used on the Rooms screen. */
export function RoomCoverCard({
  room,
  devices,
  homeId,
  index,
}: {
  room: Room;
  devices: Device[];
  homeId: string;
  index: number;
}) {
  const s = roomStats(devices);
  const setPower = useRoomPower(homeId);
  return (
    <Link
      href={`/rooms/${room.id}`}
      className={clsx(
        'relative isolate flex min-h-48 flex-col justify-between overflow-hidden rounded-card bg-gradient-to-br p-5 text-white shadow-card transition active:scale-[0.99] sm:min-h-56',
        covers[index % covers.length],
      )}
    >
      <Icon
        name={room.icon}
        className="-z-10 absolute -right-6 -bottom-8 size-48 text-white/10"
        strokeWidth={1.2}
      />
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-2xl drop-shadow">{room.name}</h3>
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-full bg-white text-brand-500 shadow-card">
            <Icon name={room.icon} className="size-6" />
          </span>
          {s.switchable.length > 0 && (
            <Toggle
              label={`All devices in ${room.name}`}
              checked={s.active > 0}
              onChange={(on) => setPower(devices, on)}
            />
          )}
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="font-bold text-4xl">
            {s.active}/{s.switchable.length || s.total}
          </div>
          <div className="text-sm text-white/85">Devices active</div>
        </div>
        {s.temperature !== null && (
          <div className="rounded-2xl bg-white px-4 py-2 text-ink shadow-card">
            <div className="flex items-center gap-1 font-semibold text-brand-600">
              <Thermometer className="size-4" />
              {s.temperature.toFixed(0)}°C
            </div>
            <div className="text-muted text-xs">Temperature</div>
          </div>
        )}
      </div>
    </Link>
  );
}
