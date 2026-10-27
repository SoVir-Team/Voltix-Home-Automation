'use client';

import { Cpu, Plus, Search, Tablet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DeviceCard } from '@/components/devices/device-card';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { ButtonLink, IconLink } from '@/components/ui/button';
import { Hero } from '@/components/ui/card';
import { ChipTabs } from '@/components/ui/chips';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useDevices, useRooms } from '@/lib/queries';

export default function DevicesPage() {
  const { home, canManage } = useHome();
  const rooms = useRooms(home.id);
  const devices = useDevices(home.id);
  const [room, setRoom] = useState('all');
  const [q, setQ] = useState('');

  const roomName = useMemo(() => new Map(rooms.data?.map((r) => [r.id, r.name])), [rooms.data]);
  const all = devices.data ?? [];
  const online = all.filter((d) => d.online).length;
  const list = all.filter(
    (d) =>
      (room === 'all' || (room === 'none' ? !d.roomId : d.roomId === room)) &&
      (!q || d.name.toLowerCase().includes(q.trim().toLowerCase())),
  );

  return (
    <Page>
      <PageHeader
        title="My Devices"
        actions={
          canManage && (
            <IconLink href="/boards" label="Boards">
              <Cpu className="size-5" />
            </IconLink>
          )
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        {canManage && (
          <ButtonLink
            href="/devices/add"
            variant="outline"
            className="shrink-0"
            icon={<Plus className="size-5" />}
          >
            Add Device
          </ButtonLink>
        )}
        <label className="relative flex-1">
          <span className="sr-only">Search devices</span>
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-5 size-5 text-subtle" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search device"
            className="h-12 w-full rounded-full bg-surface pr-5 pl-13 shadow-card outline-none placeholder:text-subtle focus:ring-4 focus:ring-brand-100"
          />
        </label>
      </div>

      <Hero
        className="mt-5"
        icon={<Tablet className="size-7" strokeWidth={1.6} />}
        title={`Total ${all.length} device${all.length === 1 ? '' : 's'}`}
        subtitle={`${online} online · Connect & manage devices`}
      />

      <ChipTabs
        className="mt-5"
        value={room}
        onChange={setRoom}
        options={[
          { value: 'all', label: 'All' },
          ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name })),
          ...(all.some((d) => !d.roomId) ? [{ value: 'none', label: 'Unassigned' }] : []),
        ]}
      />

      <div className="mt-5">
        {devices.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        ) : list.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {list.map((d) => (
              <DeviceCard key={d.id} device={d} roomName={d.roomId ? roomName.get(d.roomId) : undefined} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Tablet className="size-8" />} title={q ? 'No matches' : 'No devices here'}>
            {q ? 'Try a different name.' : 'Devices you add or move to this room appear here.'}
          </EmptyState>
        )}
      </div>
    </Page>
  );
}
