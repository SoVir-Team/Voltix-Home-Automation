'use client';

import { useState } from 'react';
import { roomIcons } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { IconPicker } from '@/components/ui/icon-picker';
import { Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { qk, useApiMutation } from '@/lib/queries';

/** Create or edit a room (name + icon). */
export function RoomSheet({
  open,
  onClose,
  homeId,
  room,
}: {
  open: boolean;
  onClose: () => void;
  homeId: string;
  room?: { id: string; name: string; icon: string };
}) {
  const [name, setName] = useState(room?.name ?? '');
  const [icon, setIcon] = useState(room?.icon ?? 'sofa');
  const save = useApiMutation(
    () =>
      room
        ? api.patch(`/rooms/${room.id}`, { name, icon })
        : api.post(`/homes/${homeId}/rooms`, { name, icon }),
    {
      invalidate: [qk.rooms(homeId)],
      success: room ? 'Room updated' : 'Room added',
      onSuccess: () => {
        if (!room) setName('');
        onClose();
      },
    },
  );
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={room ? 'Edit room' : 'New room'}
      footer={
        <Button
          className="w-full"
          loading={save.isPending}
          disabled={!name.trim()}
          onClick={() => save.mutate(undefined)}
        >
          {room ? 'Save' : 'Add room'}
        </Button>
      }
    >
      <div className="space-y-5">
        <Field label="Name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Guest Bedroom"
            maxLength={40}
            autoFocus
          />
        </Field>
        <IconPicker icons={roomIcons} value={icon} onChange={setIcon} />
      </div>
    </Sheet>
  );
}
