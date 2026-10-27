'use client';

import { Pencil, Power, PowerOff, Tablet, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { DeviceCard } from '@/components/devices/device-card';
import { roomStats, useRoomPower } from '@/components/devices/room-card';
import { RoomSheet } from '@/components/devices/room-sheet';
import { useHome } from '@/components/home-context';
import { Page, PageHeader } from '@/components/layout/page';
import { Button, IconButton } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { ConfirmSheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { qk, useApiMutation, useDevices, useRooms } from '@/lib/queries';

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const { home, canManage } = useHome();
  const rooms = useRooms(home.id);
  const devices = useDevices(home.id);
  const setPower = useRoomPower(home.id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const room = rooms.data?.find((r) => r.id === roomId);
  const list = (devices.data ?? []).filter((d) => d.roomId === roomId);
  const stats = roomStats(list);

  const remove = useApiMutation(() => api.del(`/rooms/${roomId}`), {
    invalidate: [qk.rooms(home.id), qk.devices(home.id)],
    success: 'Room deleted',
    onSuccess: () => router.replace('/rooms'),
  });

  if (rooms.isPending)
    return (
      <Page>
        <Skeleton className="mt-20 h-60" />
      </Page>
    );
  if (!room)
    return (
      <Page>
        <PageHeader title="Room not found" back="/rooms" />
      </Page>
    );

  return (
    <Page>
      <PageHeader
        title={room.name}
        subtitle={`${stats.active} of ${stats.switchable.length || stats.total} devices on${stats.temperature !== null ? ` · ${stats.temperature.toFixed(0)}°C` : ''}`}
        back="/rooms"
        actions={
          canManage && (
            <>
              <IconButton label="Edit room" onClick={() => setEditing(true)}>
                <Pencil className="size-5" />
              </IconButton>
              <IconButton label="Delete room" onClick={() => setDeleting(true)} className="hidden sm:grid">
                <Trash2 className="size-5" />
              </IconButton>
            </>
          )
        }
      />

      {stats.switchable.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Button
            variant="primary"
            size="lg"
            icon={<Power className="size-5" />}
            onClick={() => setPower(list, true)}
          >
            All on
          </Button>
          <Button
            variant="outline"
            size="lg"
            icon={<PowerOff className="size-5" />}
            onClick={() => setPower(list, false)}
          >
            All off
          </Button>
        </div>
      )}

      {list.length ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
          {list.map((d) => (
            <DeviceCard key={d.id} device={d} roomName={room.name} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Tablet className="size-8" />} title="No devices in this room">
          Open a device and choose this room in its settings.
        </EmptyState>
      )}

      {canManage && (
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="mt-8 w-full rounded-full py-3 font-semibold text-danger sm:hidden"
        >
          Delete room
        </button>
      )}

      <RoomSheet
        key={room.id + room.name}
        open={editing}
        onClose={() => setEditing(false)}
        homeId={home.id}
        room={room}
      />
      <ConfirmSheet
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title="Delete this room?"
        message={`Devices in ${room.name} stay in your home and become unassigned.`}
      />
    </Page>
  );
}
