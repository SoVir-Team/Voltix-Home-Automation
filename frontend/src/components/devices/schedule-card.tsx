'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useHome } from '@/components/home-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DayPicker, Field, Input } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/toggle';
import { api } from '@/lib/api';
import { daysLabel } from '@/lib/automation';
import { hhmmLabel } from '@/lib/format';
import { qk, useApiMutation, useAutomations } from '@/lib/queries';
import type { Automation, Device } from '@/lib/types';

/** Window schedules that switch this device on at start and off at end (the device-page "Schedule" card). */
function isDeviceWindow(a: Automation, deviceId: string) {
  return (
    a.trigger.kind === 'window' &&
    a.actions.length === 1 &&
    a.actions[0]!.kind === 'device' &&
    a.actions[0]!.deviceId === deviceId
  );
}

export function ScheduleCard({ device }: { device: Device }) {
  const { home, canManage } = useHome();
  const autos = useAutomations(home.id);
  const [editing, setEditing] = useState<Automation | 'new' | null>(null);
  const schedules = (autos.data ?? []).filter((a) => isDeviceWindow(a, device.id));

  const toggle = useApiMutation(
    (a: { id: string; enabled: boolean }) => api.patch(`/automations/${a.id}`, { enabled: a.enabled }),
    {
      invalidate: [qk.automations(home.id)],
    },
  );

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold text-2xl">Schedule</h2>
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            icon={<Plus className="size-4" />}
            onClick={() => setEditing('new')}
          >
            Add
          </Button>
        )}
      </div>
      {schedules.length === 0 && (
        <p className="mt-3 text-muted text-sm">
          {canManage ? 'Turn this device on and off automatically every day.' : 'No schedule set.'}
        </p>
      )}
      <div className="mt-4 space-y-4">
        {schedules.map((a) => {
          const t = a.trigger as Extract<Automation['trigger'], { kind: 'window' }>;
          return (
            <div key={a.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="truncate text-muted text-sm">{daysLabel(t.days)}</span>
                <div className="flex items-center gap-2">
                  {canManage && (
                    <button
                      type="button"
                      aria-label="Edit schedule"
                      onClick={() => setEditing(a)}
                      className="grid size-9 place-items-center rounded-full text-muted hover:bg-tint hover:text-brand-600"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                  <Toggle
                    label="Schedule enabled"
                    checked={a.enabled}
                    disabled={!canManage}
                    onChange={(enabled) => toggle.mutate({ id: a.id, enabled })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TimeBox label="Start time" value={hhmmLabel(t.start)} />
                <TimeBox label="End time" value={hhmmLabel(t.end)} />
              </div>
            </div>
          );
        })}
      </div>
      {editing && (
        <ScheduleSheet
          key={editing === 'new' ? 'new' : editing.id}
          device={device}
          existing={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}

function TimeBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-tile bg-tint px-4 py-3">
      <div className="text-muted text-sm">{label}</div>
      <div className="font-bold text-brand-600 text-xl">{value}</div>
    </div>
  );
}

function ScheduleSheet({
  device,
  existing,
  onClose,
}: {
  device: Device;
  existing?: Automation;
  onClose: () => void;
}) {
  const { home } = useHome();
  const t = existing?.trigger.kind === 'window' ? existing.trigger : undefined;
  const [start, setStart] = useState(t?.start ?? '18:00');
  const [end, setEnd] = useState(t?.end ?? '23:00');
  const [days, setDays] = useState<number[]>(t?.days ?? [0, 1, 2, 3, 4, 5, 6]);

  const body = () => ({
    name: `${device.name} schedule`,
    enabled: true,
    trigger: { kind: 'window', start, end, ...(days.length < 7 && { days }) },
    actions: [{ kind: 'device', deviceId: device.id, action: 'setPowerState', value: { state: 'On' } }],
    endActions: [{ kind: 'device', deviceId: device.id, action: 'setPowerState', value: { state: 'Off' } }],
  });
  const save = useApiMutation(
    () =>
      existing
        ? api.patch(`/automations/${existing.id}`, body())
        : api.post(`/homes/${home.id}/automations`, body()),
    { invalidate: [qk.automations(home.id)], success: 'Schedule saved', onSuccess: onClose },
  );
  const remove = useApiMutation(() => api.del(`/automations/${existing!.id}`), {
    invalidate: [qk.automations(home.id)],
    success: 'Schedule removed',
    onSuccess: onClose,
  });

  return (
    <Sheet
      open
      onClose={onClose}
      title={existing ? 'Edit schedule' : 'New schedule'}
      footer={
        <>
          {existing && (
            <Button
              variant="soft"
              aria-label="Delete schedule"
              onClick={() => remove.mutate(undefined)}
              loading={remove.isPending}
              icon={<Trash2 className="size-4 text-danger" />}
            />
          )}
          <Button
            className="flex-1"
            onClick={() => save.mutate(undefined)}
            loading={save.isPending}
            disabled={!days.length || start === end}
          >
            Save schedule
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-muted text-sm">
          {device.name} turns on at the start time and off at the end time, in your home's time zone (
          {home.timezone}).
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start time">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="End time" hint={end <= start ? 'Ends the next day' : undefined}>
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
        </div>
        <div>
          <span className="mb-2 block font-semibold text-ink-soft text-sm">Repeat on</span>
          <DayPicker value={days} onChange={setDays} />
        </div>
      </div>
    </Sheet>
  );
}
