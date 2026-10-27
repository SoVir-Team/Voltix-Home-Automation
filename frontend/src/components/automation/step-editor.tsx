'use client';

import { Trash2 } from 'lucide-react';
import { Field, Input, Select } from '@/components/ui/field';
import { matchOp, opsFor, opValue } from '@/lib/device-ops';
import type { Device } from '@/lib/types';

export interface Step {
  deviceId: string;
  action: string;
  value: Record<string, unknown>;
}

/** First thing a new step does: switch on the first device that can be controlled. */
export function defaultStep(devices: Device[]): Step | null {
  for (const d of devices) {
    const op = opsFor(d)[0];
    if (op) return { deviceId: d.id, action: op.action, value: opValue(op) };
  }
  return null;
}

/** Pick a device, what to do with it, and (for levels/modes) the value. */
export function StepEditor({
  step,
  devices,
  onChange,
  onRemove,
}: {
  step: Step;
  devices: Device[];
  onChange: (s: Step) => void;
  onRemove?: () => void;
}) {
  const controllable = devices.filter((d) => opsFor(d).length);
  const device = devices.find((d) => d.id === step.deviceId);
  const ops = device ? opsFor(device) : [];
  const op = device ? matchOp(device, step.action, step.value) : undefined;
  const input = op?.input;

  return (
    <div className="rounded-2xl border border-line bg-tint/50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Device">
          <Select
            value={step.deviceId}
            onChange={(e) => {
              const d = devices.find((x) => x.id === e.target.value)!;
              const first = opsFor(d)[0]!;
              onChange({ deviceId: d.id, action: first.action, value: opValue(first) });
            }}
          >
            {!device && <option value={step.deviceId}>Removed device</option>}
            {controllable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Do">
          <Select
            value={op?.id ?? ''}
            onChange={(e) => {
              const next = ops.find((o) => o.id === e.target.value)!;
              onChange({ ...step, action: next.action, value: opValue(next) });
            }}
          >
            {!op && <option value="">{step.action}</option>}
            {ops.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3 flex items-end gap-3">
        {input && op && (
          <Field label={input.unit ? `Value (${input.unit})` : 'Value'} className="flex-1">
            {input.choices ? (
              <Select
                value={String(step.value[input.key] ?? input.initial)}
                onChange={(e) => onChange({ ...step, value: opValue(op, e.target.value) })}
              >
                {input.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type="number"
                inputMode="numeric"
                min={input.min}
                max={input.max}
                value={String(step.value[input.key] ?? input.initial)}
                onChange={(e) => {
                  const n = Math.min(input.max ?? 100, Math.max(input.min ?? 0, Number(e.target.value) || 0));
                  onChange({ ...step, value: opValue(op, n) });
                }}
              />
            )}
          </Field>
        )}
        {onRemove && (
          <button
            type="button"
            aria-label="Remove step"
            onClick={onRemove}
            className="ml-auto grid size-12 shrink-0 place-items-center rounded-2xl text-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="size-5" />
          </button>
        )}
      </div>
    </div>
  );
}
