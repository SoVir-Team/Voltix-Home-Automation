'use client';

import { Plus, SlidersHorizontal, Zap } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RoomCoverCard } from '@/components/devices/room-card';
import { RoomSheet } from '@/components/devices/room-sheet';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { Button, IconLink } from '@/components/ui/button';
import { Hero } from '@/components/ui/card';
import { ChipTabs } from '@/components/ui/chips';
import { Skeleton } from '@/components/ui/misc';
import { kwh } from '@/lib/format';
import { useDevices, useEnergy, useRooms } from '@/lib/queries';

export default function RoomsPage() {
  const { home, canManage } = useHome();
  const rooms = useRooms(home.id);
  const devices = useDevices(home.id);
  const energy = useEnergy(home.id, 'week', canManage || home.memberPermissions.energy);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);

  const list = (rooms.data ?? []).filter((r) => filter === 'all' || r.id === filter);

  return (
    <Page>
      <PageHeader
        title="My Rooms"
        actions={
          <IconLink href="/settings" label="Home settings">
            <SlidersHorizontal className="size-5" />
          </IconLink>
        }
      />
      <ChipTabs
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          ...(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      {energy.data && (
        <Link href="/energy" className="mt-5 block">
          <Hero
            icon={<Zap className="size-7" strokeWidth={1.6} />}
            title="Energy consumption"
            subtitle="This week"
            aside={
              <span className="shrink-0 font-medium text-2xl sm:text-3xl">
                {kwh(energy.data.totalKwh)} kWh
              </span>
            }
          />
        </Link>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {rooms.isPending || devices.isPending ? (
          <>
            <Skeleton className="h-52" />
            <Skeleton className="h-52" />
          </>
        ) : (
          list.map((r, i) => (
            <RoomCoverCard
              key={r.id}
              room={r}
              index={i}
              homeId={home.id}
              devices={(devices.data ?? []).filter((d) => d.roomId === r.id)}
            />
          ))
        )}
      </div>

      {canManage && (
        <Button
          variant="outline"
          size="lg"
          className="mt-5 w-full"
          icon={<Plus className="size-5" />}
          onClick={() => setAdding(true)}
        >
          Add Room
        </Button>
      )}
      <RoomSheet open={adding} onClose={() => setAdding(false)} homeId={home.id} />
    </Page>
  );
}
