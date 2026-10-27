'use client';

import { BellRing, Clock, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { defaultStep, type Step, StepEditor } from '@/components/automation/step-editor';
import { useHome } from '@/components/home-context';
import { Button } from '@/components/ui/button';
import { DayPicker, Field, Input, Select } from '@/components/ui/field';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { type AutomationTab, dailyCron, parseDailyCron } from '@/lib/automation';
import { watchKeysFor } from '@/lib/device-ops';
import { qk, useApiMutation, useScenes } from '@/lib/queries';
import type { Automation, AutomationAction, Condition, Device, Trigger } from '@/lib/types';

const allDays = [0, 1, 2, 3, 4, 5, 6];

function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Sensible first trigger for each tab. */
function initialTrigger(tab: AutomationTab, devices: Device[]): Trigger {
  if (tab === 'timers') return { kind: 'once', at: new Date(Date.now() + 30 * 60_000).toISOString() };
  if (tab === 'rules') {
    const d = devices.find((x) => watchKeysFor(x).length) ?? devices[0];
    const k = d ? watchKeysFor(d)[0] : undefined;
    return {
      kind: 'device',
      deviceId: d?.id ?? '',
      key: k?.key ?? 'powerState',
      op: k?.changed ? 'changed' : 'eq',
      value: k?.choices?.[0]?.value,
    };
  }
  return { kind: 'time', cron: dailyCron('19:00', allDays) };
}

export function AutomationSheet({
  existing,
  tab,
  devices,
  onClose,
}: {
  existing?: Automation;
  tab: AutomationTab;
  devices: Device[];
  onClose: () => void;
}) {
  const { home } = useHome();
  const scenes = useScenes(home.id);
  const [name, setName] = useState(existing?.name ?? '');
  const [trigger, setTrigger] = useState<Trigger>(existing?.trigger ?? initialTrigger(tab, devices));
  const [conditions, setConditions] = useState<Condition[]>(existing?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(
    existing?.actions ??
      [defaultStep(devices)].filter((s) => s !== null).map((s) => ({ kind: 'device' as const, ...s })),
  );
  const [endActions, setEndActions] = useState<AutomationAction[]>(existing?.endActions ?? []);
  const [confirm, setConfirm] = useState(false);

  const body = () => ({
    name: name.trim(),
    trigger,
    conditions,
    actions,
    ...(trigger.kind === 'window' ? { endActions } : {}),
  });
  const save = useApiMutation(
    () =>
      existing
        ? api.patch(`/automations/${existing.id}`, body())
        : api.post(`/homes/${home.id}/automations`, body()),
    { invalidate: [qk.automations(home.id)], success: existing ? 'Saved' : 'Created', onSuccess: onClose },
  );
  const remove = useApiMutation(() => api.del(`/automations/${existing!.id}`), {
    invalidate: [qk.automations(home.id)],
    success: 'Deleted',
    onSuccess: onClose,
  });

  const daysCondition = conditions.find((c) => c.kind === 'days');
  const windowCondition = conditions.find((c) => c.kind === 'timeWindow');
  const setCondition = (kind: Condition['kind'], next: Condition | null) =>
    setConditions((all) => [...all.filter((c) => c.kind !== kind), ...(next ? [next] : [])]);

  return (
    <>
      <Sheet
        open
        wide
        onClose={onClose}
        title={
          existing
            ? 'Edit automation'
            : tab === 'timers'
              ? 'New timer'
              : tab === 'rules'
                ? 'New automation'
                : 'New schedule'
        }
        footer={
          <Button
            className="w-full"
            size="lg"
            loading={save.isPending}
            disabled={!name.trim() || !actions.length}
            onClick={() => save.mutate(undefined)}
          >
            Save
          </Button>
        }
      >
        <div className="space-y-6">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Porch light at sunset"
              maxLength={80}
            />
          </Field>

          <section>
            <h3 className="mb-3 font-bold text-lg">When</h3>
            <TriggerEditor trigger={trigger} onChange={setTrigger} devices={devices} tab={tab} />
            <p className="mt-2 text-muted text-xs">Times are India time (IST).</p>
          </section>

          {trigger.kind === 'device' && (
            <section>
              <h3 className="mb-3 font-bold text-lg">Only if</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-500"
                    checked={!!windowCondition}
                    onChange={(e) =>
                      setCondition(
                        'timeWindow',
                        e.target.checked ? { kind: 'timeWindow', from: '18:00', to: '06:00' } : null,
                      )
                    }
                  />
                  <span>Between certain times</span>
                </label>
                {windowCondition?.kind === 'timeWindow' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">
                      <Input
                        type="time"
                        value={windowCondition.from}
                        onChange={(e) =>
                          setCondition('timeWindow', { ...windowCondition, from: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="To">
                      <Input
                        type="time"
                        value={windowCondition.to}
                        onChange={(e) =>
                          setCondition('timeWindow', { ...windowCondition, to: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                )}
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-500"
                    checked={!!daysCondition}
                    onChange={(e) =>
                      setCondition('days', e.target.checked ? { kind: 'days', days: [1, 2, 3, 4, 5] } : null)
                    }
                  />
                  <span>On certain days</span>
                </label>
                {daysCondition?.kind === 'days' && (
                  <DayPicker
                    value={daysCondition.days}
                    onChange={(days) => days.length && setCondition('days', { kind: 'days', days })}
                  />
                )}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-3 font-bold text-lg">{trigger.kind === 'window' ? 'At the start' : 'Then'}</h3>
            <ActionList
              actions={actions}
              onChange={setActions}
              devices={devices}
              scenes={scenes.data ?? []}
            />
          </section>
          {trigger.kind === 'window' && (
            <section>
              <h3 className="mb-3 font-bold text-lg">At the end</h3>
              <ActionList
                actions={endActions}
                onChange={setEndActions}
                devices={devices}
                scenes={scenes.data ?? []}
                allowEmpty
              />
            </section>
          )}

          {existing && (
            <Button
              variant="soft"
              className="w-full text-danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => setConfirm(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate(undefined)}
        loading={remove.isPending}
        title={`Delete ${existing?.name}?`}
        message="It stops running right away."
      />
    </>
  );
}

function TriggerEditor({
  trigger,
  onChange,
  devices,
  tab,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  devices: Device[];
  tab: AutomationTab;
}) {
  if (tab === 'schedules') {
    const daily = trigger.kind === 'time' ? parseDailyCron(trigger.cron) : null;
    return (
      <div className="space-y-4">
        <Select
          value={trigger.kind === 'time' ? 'time' : trigger.kind === 'sun' ? trigger.event : 'window'}
          onChange={(e) => {
            const v = e.target.value;
            const days = 'days' in trigger && trigger.days ? trigger.days : allDays;
            if (v === 'time') onChange({ kind: 'time', cron: dailyCron('19:00', days) });
            else if (v === 'window') onChange({ kind: 'window', start: '18:00', end: '23:00', days });
            else onChange({ kind: 'sun', event: v as 'sunrise' | 'sunset', offsetMin: 0, days });
          }}
        >
          <option value="time">At a time</option>
          <option value="sunrise">At sunrise</option>
          <option value="sunset">At sunset</option>
          <option value="window">During a time window</option>
        </Select>
        {trigger.kind === 'time' &&
          (daily ? (
            <>
              <Field label="Time">
                <Input
                  type="time"
                  required
                  value={daily.time}
                  onChange={(e) =>
                    e.target.value && onChange({ kind: 'time', cron: dailyCron(e.target.value, daily.days) })
                  }
                />
              </Field>
              <DayPicker
                value={daily.days}
                onChange={(d) => d.length && onChange({ kind: 'time', cron: dailyCron(daily.time, d) })}
              />
            </>
          ) : (
            <Field label="Cron (minute hour day month weekday)">
              <Input
                value={trigger.cron}
                onChange={(e) => onChange({ kind: 'time', cron: e.target.value })}
              />
            </Field>
          ))}
        {trigger.kind === 'sun' && (
          <>
            <Field
              label="Offset (minutes)"
              hint="Negative runs before, positive after. Needs the home's location in Settings."
            >
              <Input
                type="number"
                min={-180}
                max={180}
                value={trigger.offsetMin}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    offsetMin: Math.max(-180, Math.min(180, Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>
            <DayPicker
              value={trigger.days ?? allDays}
              onChange={(d) => d.length && onChange({ ...trigger, days: d })}
            />
          </>
        )}
        {trigger.kind === 'window' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start">
                <Input
                  type="time"
                  required
                  value={trigger.start}
                  onChange={(e) => e.target.value && onChange({ ...trigger, start: e.target.value })}
                />
              </Field>
              <Field label="End">
                <Input
                  type="time"
                  required
                  value={trigger.end}
                  onChange={(e) => e.target.value && onChange({ ...trigger, end: e.target.value })}
                />
              </Field>
            </div>
            <DayPicker
              value={trigger.days ?? allDays}
              onChange={(d) => d.length && onChange({ ...trigger, days: d })}
            />
          </>
        )}
      </div>
    );
  }

  if (trigger.kind === 'once') {
    const at = new Date(trigger.at);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[15, 30, 60, 120].map((m) => (
            <Button
              key={m}
              size="sm"
              variant="soft"
              icon={<Clock className="size-4" />}
              onClick={() => onChange({ kind: 'once', at: new Date(Date.now() + m * 60_000).toISOString() })}
            >
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </Button>
          ))}
        </div>
        <Field label="Run at">
          <Input
            type="datetime-local"
            value={localInput(at)}
            min={localInput(new Date())}
            onChange={(e) =>
              e.target.value && onChange({ kind: 'once', at: new Date(e.target.value).toISOString() })
            }
          />
        </Field>
      </div>
    );
  }

  if (trigger.kind !== 'device') return null;
  const device = devices.find((d) => d.id === trigger.deviceId);
  const keys = device ? watchKeysFor(device) : [];
  const key = keys.find((k) => k.key === trigger.key);
  const watchable = devices.filter((d) => watchKeysFor(d).length);
  return (
    <div className="space-y-3">
      <Field label="Device">
        <Select
          value={trigger.deviceId}
          onChange={(e) => {
            const d = devices.find((x) => x.id === e.target.value)!;
            const k = watchKeysFor(d)[0]!;
            onChange({
              kind: 'device',
              deviceId: d.id,
              key: k.key,
              op: k.changed ? 'changed' : 'eq',
              value: k.choices?.[0]?.value,
              hysteresis: 0,
            });
          }}
        >
          {watchable.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Watch">
          <Select
            value={trigger.key}
            onChange={(e) => {
              const k = keys.find((x) => x.key === e.target.value)!;
              onChange({
                ...trigger,
                key: k.key,
                op: k.changed ? 'changed' : k.choices ? 'eq' : 'gt',
                value: k.choices?.[0]?.value ?? (k.changed ? undefined : 30),
              });
            }}
          >
            {keys.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        {key?.choices && (
          <Field label="Becomes">
            <Select
              value={String(trigger.value)}
              onChange={(e) => onChange({ ...trigger, op: 'eq', value: e.target.value })}
            >
              {key.choices.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {key && !key.choices && !key.changed && (
          <Field label="Goes">
            <Select
              value={trigger.op}
              onChange={(e) => onChange({ ...trigger, op: e.target.value as 'gt' | 'lt' })}
            >
              <option value="gt">above</option>
              <option value="lt">below</option>
            </Select>
          </Field>
        )}
      </div>
      {key && !key.choices && !key.changed && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Value (${key.unit})`}>
            <Input
              type="number"
              inputMode="decimal"
              value={String(trigger.value ?? '')}
              onChange={(e) => onChange({ ...trigger, value: Number(e.target.value) })}
            />
          </Field>
          <Field label="Re-arm margin" hint="Avoids repeats near the limit">
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              value={trigger.hysteresis ?? 0}
              onChange={(e) => onChange({ ...trigger, hysteresis: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function ActionList({
  actions,
  onChange,
  devices,
  scenes,
  allowEmpty,
}: {
  actions: AutomationAction[];
  onChange: (a: AutomationAction[]) => void;
  devices: Device[];
  scenes: { id: string; name: string }[];
  allowEmpty?: boolean;
}) {
  const set = (i: number, a: AutomationAction) => onChange(actions.map((x, j) => (j === i ? a : x)));
  const drop = (i: number) => onChange(actions.filter((_, j) => j !== i));
  const canDrop = allowEmpty || actions.length > 1;
  const removeBtn = (i: number) =>
    canDrop && (
      <button
        type="button"
        aria-label="Remove"
        onClick={() => drop(i)}
        className="grid size-12 shrink-0 place-items-center rounded-2xl text-muted hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 className="size-5" />
      </button>
    );

  return (
    <div className="space-y-3">
      {actions.map((a, i) => {
        const key = `${i}-${a.kind}`;
        if (a.kind === 'device')
          return (
            <StepEditor
              key={key}
              step={a}
              devices={devices}
              onChange={(s: Step) => set(i, { kind: 'device', ...s })}
              onRemove={canDrop ? () => drop(i) : undefined}
            />
          );
        if (a.kind === 'scene')
          return (
            <div key={key} className="flex items-end gap-3 rounded-2xl border border-line bg-tint/50 p-3">
              <Field label="Run scene" className="flex-1">
                <Select
                  value={a.sceneId}
                  onChange={(e) => set(i, { kind: 'scene', sceneId: e.target.value })}
                >
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {removeBtn(i)}
            </div>
          );
        if (a.kind === 'notify')
          return (
            <div key={key} className="flex items-end gap-3 rounded-2xl border border-line bg-tint/50 p-3">
              <Field label="Send notification" className="flex-1">
                <Input
                  value={a.title}
                  maxLength={100}
                  placeholder="Front door opened"
                  onChange={(e) => set(i, { ...a, title: e.target.value })}
                />
              </Field>
              {removeBtn(i)}
            </div>
          );
        return (
          <div key={key} className="flex items-end gap-3 rounded-2xl border border-line bg-tint/50 p-3">
            <Field label="Wait (seconds)" className="flex-1">
              <Input
                type="number"
                min={1}
                max={3600}
                value={a.seconds}
                onChange={(e) =>
                  set(i, { kind: 'delay', seconds: Math.max(1, Math.min(3600, Number(e.target.value) || 1)) })
                }
              />
            </Field>
            {removeBtn(i)}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          icon={<Plus className="size-4" />}
          onClick={() => {
            const s = defaultStep(devices);
            if (s) onChange([...actions, { kind: 'device', ...s }]);
          }}
        >
          Device
        </Button>
        {scenes.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            icon={<Sparkles className="size-4" />}
            onClick={() => onChange([...actions, { kind: 'scene', sceneId: scenes[0]!.id }])}
          >
            Scene
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          icon={<BellRing className="size-4" />}
          onClick={() => onChange([...actions, { kind: 'notify', title: 'Voltix alert', body: '' }])}
        >
          Notify
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<Clock className="size-4" />}
          onClick={() => onChange([...actions, { kind: 'delay', seconds: 60 }])}
        >
          Wait
        </Button>
      </div>
    </div>
  );
}
