'use client';

import { ArrowDownRight, ArrowUpRight, Bell, Plus, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DeviceCard } from '@/components/devices/device-card';
import { RoomSummaryCard } from '@/components/devices/room-card';
import { useHome } from '@/components/home-context';
import { Page } from '@/components/layout/page';
import { ButtonLink, IconLink } from '@/components/ui/button';
import { Hero, SectionHeader } from '@/components/ui/card';
import { ChipTabs } from '@/components/ui/chips';
import { Avatar, EmptyState, Skeleton } from '@/components/ui/misc';
import { greeting, kwh } from '@/lib/format';
import { useDevices, useEnergy, useNotifications, useRooms } from '@/lib/queries';

export default function HomeDashboard() {
  const { user, home, canManage } = useHome();
  const rooms = useRooms(home.id);
  const devices = useDevices(home.id);
  const canSeeEnergy = canManage || home.memberPermissions.energy;
  const energy = useEnergy(home.id, 'month', canSeeEnergy);
  const notes = useNotifications();
  const [room, setRoom] = useState('all');

  const roomName = useMemo(() => new Map(rooms.data?.map((r) => [r.id, r.name])), [rooms.data]);
  const visible = (devices.data ?? []).filter((d) => room === 'all' || d.roomId === room);
  const featured = [...visible].sort((a, b) => Number(b.favorite) - Number(a.favorite)).slice(0, 8);
  const change = energy.data?.changePct;

  return (
    <Page>
      <header className="flex items-center justify-between gap-3 pt-3 lg:pt-0">
        <Link href="/profile" className="flex min-w-0 items-center gap-3">
          <Avatar name={user.name} size={48} />
          <div className="min-w-0">
            <p className="truncate text-muted text-sm">Hello, {user.name.split(' ')[0]}</p>
            <p className="truncate font-bold text-lg">{greeting()}</p>
          </div>
        </Link>
        <div className="flex gap-2 sm:gap-3">
          <IconLink href="/scenes" label="Scenes">
            <Sparkles className="size-5" />
          </IconLink>
          <IconLink href="/notifications" label="Notifications" badge={(notes.data?.unreadCount ?? 0) > 0}>
            <Bell className="size-5" />
          </IconLink>
          <IconLink href="/settings" label="Home settings">
            <SlidersHorizontal className="size-5" />
          </IconLink>
        </div>
      </header>

      <h1 className="mt-6 mb-5 font-medium text-[2.1rem] leading-[1.12] tracking-tight sm:text-5xl">
        Set Up Devices,
        <br />
        Take Control
      </h1>

      <ChipTabs
        value={room}
        onChange={setRoom}
        options={[
          { value: 'all', label: 'All' },
          ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]}
      />

      {canSeeEnergy && (
        <Link href="/energy" className="mt-5 block">
          <Hero
            icon={<Zap className="size-8" strokeWidth={1.6} />}
            title={
              <span className="font-medium text-3xl sm:text-4xl">
                {energy.data ? kwh(energy.data.totalKwh) : '–'} <span className="text-2xl">kWh</span>
              </span>
            }
            subtitle={`This month · ${home.name}`}
            aside={
              change != null && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-4 py-2 font-semibold text-brand-600 text-sm">
                  {change >= 0 ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                  {change > 0 ? '+' : ''}
                  {change}%
                </span>
              )
            }
          />
        </Link>
      )}

      <section className="mt-8">
        <SectionHeader title="Rooms" href="/rooms" />
        {rooms.isPending || devices.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-44" />
            <Skeleton className="h-44" />
          </div>
        ) : (
          <div className="no-scrollbar -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
            {(rooms.data ?? [])
              .filter((r) => room === 'all' || r.id === room)
              .map((r) => (
                <div key={r.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
                  <RoomSummaryCard
                    room={r}
                    homeId={home.id}
                    devices={(devices.data ?? []).filter((d) => d.roomId === r.id)}
                  />
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionHeader title="Devices" href="/devices" />
        {devices.isPending ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-52" />
            ))}
          </div>
        ) : featured.length ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {featured.map((d) => (
              <DeviceCard key={d.id} device={d} roomName={d.roomId ? roomName.get(d.roomId) : undefined} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Plus className="size-8" />}
            title="No devices yet"
            action={
              canManage && (
                <ButtonLink href="/devices/add" icon={<Plus className="size-5" />}>
                  Add a device
                </ButtonLink>
              )
            }
          >
            Connect a Voltix board and its lights, fans and sockets show up here.
          </EmptyState>
        )}
      </section>
    </Page>
  );
}
