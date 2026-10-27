'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/field';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { hasCap } from '@/lib/format';
import { qk, useApiMutation, useRooms } from '@/lib/queries';
import type { Device } from '@/lib/types';

export function DeviceSettingsSheet({
  device,
  open,
  onClose,
}: {
  device: Device;
  open: boolean;
  onClose: () => void;
}) {
  const { home, canManage } = useHome();
  const router = useRouter();
  const rooms = useRooms(home.id);
  const [name, setName] = useState(device.name);
  const [roomId, setRoomId] = useState(device.roomId ?? '');
  const [watts, setWatts] = useState(String(device.config.ratedWatts ?? ''));
  const [behavior, setBehavior] = useState(device.config.powerOnBehavior ?? 'last');
  const [favorite, setFavorite] = useState(device.favorite);
  const [confirm, setConfirm] = useState(false);

  const save = useApiMutation(
    () =>
      api.patch(
        `/devices/${device.id}`,
        canManage
          ? {
              name,
              roomId: roomId || null,
              favorite,
              config: {
                ...device.config,
                ...(watts !== '' && { ratedWatts: Number(watts) }),
                powerOnBehavior: behavior,
              },
            }
          : { favorite },
      ),
    {
      invalidate: [qk.devices(home.id), qk.device(device.id), qk.rooms(home.id)],
      success: 'Device updated',
      onSuccess: onClose,
    },
  );
  const remove = useApiMutation(() => api.del(`/devices/${device.id}`), {
    invalidate: [qk.devices(home.id), qk.rooms(home.id)],
    success: 'Device removed',
    onSuccess: () => router.replace('/devices'),
  });

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Device settings"
        footer={
          <Button
            className="w-full"
            onClick={() => save.mutate(undefined)}
            loading={save.isPending}
            disabled={!name.trim()}
          >
            Save
          </Button>
        }
      >
        <div className="space-y-5">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={!canManage}
            />
          </Field>
          <Field label="Room">
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!canManage}>
              <option value="">No room</option>
              {rooms.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          {hasCap(device, 'powerState') && canManage && (
            <>
              <Field
                label="Rated power (watts)"
                hint="Used to estimate energy use. Check the label on the appliance."
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={50000}
                  value={watts}
                  onChange={(e) => setWatts(e.target.value)}
                  placeholder="e.g. 60"
                />
              </Field>
              <Field label="After a power cut" hint="What the board does when electricity comes back.">
                <Select value={behavior} onChange={(e) => setBehavior(e.target.value as typeof behavior)}>
                  <option value="last">Restore its last state</option>
                  <option value="off">Stay off</option>
                  <option value="cloud">Ask Voltix for the latest state</option>
                </Select>
              </Field>
            </>
          )}
          <Checkbox
            label="Show first on the home screen"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
          {device.controllerId && (
            <p className="rounded-2xl bg-tint p-4 text-muted text-sm">
              Channel {device.channel} on its board · type <code>{device.type}</code>
            </p>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="w-full rounded-full py-3 font-semibold text-danger hover:bg-red-50"
            >
              Remove device
            </button>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title="Remove this device?"
        message="Its history and schedules are deleted. If the board still reports this channel, it will be added again as a new device."
        confirmLabel="Remove"
      />
    </>
  );
}
