'use client';

import { builtinTemplateMap } from '@voltix/protocol';
import { clsx } from 'clsx';
import {
  BellRing,
  ChevronDown,
  ChevronUp,
  DoorClosed,
  DoorOpen,
  Droplet,
  Fan,
  Lock,
  LockOpen,
  Minus,
  Pause,
  Play,
  Plus,
  Power,
  Radar,
  SkipBack,
  SkipForward,
  Snowflake,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icon';
import { Card } from '@/components/ui/card';
import { ModeTile } from '@/components/ui/chips';
import { Toggle } from '@/components/ui/toggle';
import { hasCap, isOn, timeAgo } from '@/lib/format';
import { useDeviceAction } from '@/lib/queries';
import type { Device } from '@/lib/types';

type Send = (action: string, value: Record<string, unknown>, optimistic?: Record<string, unknown>) => void;

/**
 * A slider value that follows the device while idle, but lets the user drag freely and only sends
 * the final value (350 ms after they stop) so a drag is one command, not fifty.
 */
function useCommitted(remote: number, commit: (v: number) => void, delay = 350) {
  const [local, setLocal] = useState(remote);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!dirty.current) setLocal(remote);
  }, [remote]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const change = (v: number) => {
    dirty.current = true;
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      dirty.current = false;
      commit(v);
    }, delay);
  };
  return [local, change] as const;
}

function ControlCard({
  title,
  subtitle,
  device,
  send,
  disabled,
  children,
}: {
  title: string;
  subtitle: string;
  device: Device;
  send: Send;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-bold text-2xl sm:text-3xl">{title}</h2>
          <p className="truncate text-muted text-sm">{subtitle}</p>
        </div>
        {hasCap(device, 'powerState') && (
          <Toggle
            label={`Power ${device.name}`}
            checked={isOn(device)}
            disabled={disabled}
            onChange={(on) =>
              send('setPowerState', { state: on ? 'On' : 'Off' }, { powerState: on ? 'On' : 'Off' })
            }
          />
        )}
      </div>
      {children}
    </Card>
  );
}

// ── Climate (thermostat / AC) ───────────────────────────────────────────────

const acModes = [
  { mode: 'COOL', label: 'Cooling', icon: <Snowflake className="size-6" /> },
  { mode: 'DRY', label: 'Dry', icon: <Droplet className="size-6" /> },
  { mode: 'HEAT', label: 'Heating', icon: <Sun className="size-6" /> },
  { mode: 'FAN', label: 'Fan', icon: <Fan className="size-6" /> },
];

/** 240° arc gauge with a knob, like the Climate Control screen. */
function ArcGauge({
  value,
  min,
  max,
  children,
}: {
  value: number;
  min: number;
  max: number;
  children: ReactNode;
}) {
  const R = 100;
  const start = 150; // degrees, measured clockwise from +x
  const sweep = 240;
  const pt = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    return [120 + R * Math.cos(r), 120 + R * Math.sin(r)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = pt(from);
    const [x2, y2] = pt(to);
    return `M${x1},${y1} A${R},${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`;
  };
  const f = Math.min(1, Math.max(0, (value - min) / (max - min)));
  const end = start + sweep * f;
  const [kx, ky] = pt(end);
  return (
    <div className="relative mx-auto aspect-square w-full max-w-72">
      <svg viewBox="0 0 240 240" className="size-full" aria-hidden>
        <path
          d={arc(start, start + sweep)}
          fill="none"
          stroke="#e4f4fc"
          strokeWidth="18"
          strokeLinecap="round"
        />
        {f > 0.001 && (
          <path
            d={arc(start, end)}
            fill="none"
            stroke="#29b6f6"
            strokeWidth="18"
            strokeLinecap="round"
            className="transition-all duration-300"
          />
        )}
        <circle
          cx={kx}
          cy={ky}
          r="11"
          fill="#fff"
          stroke="#1ba8e0"
          strokeWidth="5"
          className="transition-all duration-300"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

function ClimateControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const s = device.state;
  const isAC = device.type === 'windowAC';
  const [min, max] = isAC ? [16, 30] : [10, 32];
  const target = typeof s.targetTemperature === 'number' ? s.targetTemperature : 24;
  const [temp, setTemp] = useCommitted(target, (v) =>
    send('targetTemperature', { temperature: v }, { targetTemperature: v }),
  );
  const off = hasCap(device, 'powerState') && !isOn(device);
  const step = (d: number) => setTemp(Math.min(max, Math.max(min, temp + d)));

  return (
    <>
      <ControlCard
        title="Climate Control"
        subtitle={device.name}
        device={device}
        send={send}
        disabled={disabled}
      >
        <div className={clsx('mt-2 transition-opacity', off && 'opacity-50')}>
          <ArcGauge value={temp} min={min} max={max}>
            <div>
              <div className="font-medium text-6xl tracking-tight">
                {temp}
                <span className="text-4xl">°c</span>
              </div>
              <div className="text-muted">Target</div>
              {typeof s.temperature === 'number' && (
                <div className="mt-1 text-brand-600 text-sm">Room {s.temperature.toFixed(1)}°C</div>
              )}
            </div>
          </ArcGauge>
          <div className="-mt-6 flex items-center gap-3 sm:gap-4">
            <button
              type="button"
              aria-label="Lower temperature"
              disabled={disabled}
              onClick={() => step(-1)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-tint text-brand-600"
            >
              <Minus className="size-5" />
            </button>
            <span className="text-muted text-sm">{min}°c</span>
            <input
              type="range"
              aria-label="Target temperature"
              min={min}
              max={max}
              step={1}
              value={temp}
              disabled={disabled}
              onChange={(e) => setTemp(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-brand-500"
            />
            <span className="text-muted text-sm">{max}°c</span>
            <button
              type="button"
              aria-label="Raise temperature"
              disabled={disabled}
              onClick={() => step(1)}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-tint text-brand-600"
            >
              <Plus className="size-5" />
            </button>
          </div>
        </div>
      </ControlCard>
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {acModes.map((m) => (
          <ModeTile
            key={m.mode}
            label={m.label}
            icon={m.icon}
            disabled={disabled}
            active={s.thermostatMode === m.mode}
            onClick={() => send('setThermostatMode', { thermostatMode: m.mode }, { thermostatMode: m.mode })}
          />
        ))}
      </div>
      {hasCap(device, 'powerLevel') && (
        <SpeedSteps device={device} send={send} disabled={disabled} label="Fan speed" />
      )}
    </>
  );
}

// ── Lights ──────────────────────────────────────────────────────────────────

const swatches = [
  { r: 255, g: 255, b: 255 },
  { r: 255, g: 214, b: 160 },
  { r: 41, g: 182, b: 246 },
  { r: 124, g: 77, b: 255 },
  { r: 255, g: 82, b: 120 },
  { r: 76, g: 217, b: 100 },
];

function LightControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const s = device.state;
  const key = hasCap(device, 'brightness') ? 'brightness' : 'powerLevel';
  const action = key === 'brightness' ? 'setBrightness' : 'setPowerLevel';
  const remote = typeof s[key] === 'number' ? (s[key] as number) : 100;
  const [level, setLevel] = useCommitted(remote, (v) => send(action, { [key]: v }, { [key]: v }));
  const on = isOn(device);
  const color = (s.color as { r: number; g: number; b: number } | undefined) ?? { r: 127, g: 210, b: 243 };
  const presets = builtinTemplateMap.get(device.type)?.presets ?? [];
  const activePreset = presets.find((p) =>
    p.actions.every((a) => Object.entries(a.value).every(([k, v]) => s[k] === v)),
  );

  return (
    <>
      <ControlCard
        title="Room Light Control"
        subtitle={device.name}
        device={device}
        send={send}
        disabled={disabled}
      >
        <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-4 sm:gap-8">
          <div className="flex flex-col items-center gap-2 text-muted text-xs">
            <span>High</span>
            <input
              type="range"
              aria-label={key === 'brightness' ? 'Brightness' : 'Level'}
              min={1}
              max={100}
              value={level}
              disabled={disabled}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="h-56 w-3 cursor-pointer accent-brand-500 [direction:rtl] [writing-mode:vertical-lr]"
            />
            <span>Low</span>
          </div>
          <div className="relative grid h-64 place-items-center">
            <div
              className="absolute size-56 rounded-full blur-3xl transition-all duration-500"
              style={{
                background: `rgb(${color.r} ${color.g} ${color.b})`,
                opacity: on ? 0.25 + (level / 100) * 0.6 : 0.08,
                transform: `scale(${on ? 0.7 + level / 300 : 0.6})`,
              }}
            />
            <div className="relative text-center">
              <Icon
                name={device.icon}
                className={clsx('mx-auto size-20 transition-colors', on ? 'text-brand-500' : 'text-subtle')}
                strokeWidth={1.3}
              />
              <div className="mt-3 font-bold text-3xl">{on ? `${level}%` : 'Off'}</div>
            </div>
          </div>
        </div>
        {hasCap(device, 'color') && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {swatches.map((c) => (
              <button
                key={`${c.r}-${c.g}-${c.b}`}
                type="button"
                aria-label={`Colour rgb ${c.r} ${c.g} ${c.b}`}
                disabled={disabled}
                onClick={() => send('setColor', { color: c }, { color: c })}
                className="size-9 rounded-full shadow-card ring-2 ring-white transition hover:scale-110"
                style={{ background: `rgb(${c.r} ${c.g} ${c.b})` }}
              />
            ))}
          </div>
        )}
        {presets.length > 0 && (
          <p className="mt-3 text-right text-brand-600 text-sm">Pick your preferred light mood below</p>
        )}
      </ControlCard>
      {presets.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {presets.map((p) => (
            <ModeTile
              key={p.name}
              label={p.name}
              icon={<Icon name={p.icon} className="size-6" />}
              active={activePreset?.name === p.name}
              disabled={disabled}
              onClick={() => {
                if (!on) send('setPowerState', { state: 'On' }, { powerState: 'On' });
                for (const a of p.actions) send(a.action, a.value, a.value);
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Fan / speed ─────────────────────────────────────────────────────────────

function SpeedSteps({
  device,
  send,
  disabled,
  label,
}: {
  device: Device;
  send: Send;
  disabled: boolean;
  label: string;
}) {
  const level = typeof device.state.powerLevel === 'number' ? device.state.powerLevel : 0;
  const steps = [20, 40, 60, 80, 100];
  return (
    <Card>
      <h3 className="mb-3 font-bold">{label}</h3>
      <div className="grid grid-cols-5 gap-2">
        {steps.map((v, i) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            aria-pressed={level >= v - 10 && level < v + 10}
            onClick={() => send('setPowerLevel', { powerLevel: v }, { powerLevel: v })}
            className={clsx(
              'h-12 rounded-2xl font-bold transition active:scale-95',
              level >= v - 10 ? 'bg-brand-gradient text-white shadow-float' : 'bg-tint text-muted',
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </Card>
  );
}

function FanControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const on = isOn(device);
  const level = typeof device.state.powerLevel === 'number' ? device.state.powerLevel : 60;
  return (
    <>
      <ControlCard title="Fan Control" subtitle={device.name} device={device} send={send} disabled={disabled}>
        <div className="grid h-64 place-items-center">
          <div className="relative grid place-items-center">
            <div
              className={clsx(
                'absolute size-48 rounded-full bg-brand-200 blur-3xl transition-opacity',
                on ? 'opacity-70' : 'opacity-20',
              )}
            />
            <Fan
              className={clsx('relative size-28', on ? 'animate-spin text-brand-500' : 'text-subtle')}
              style={{ animationDuration: `${Math.max(0.35, 2.4 - level / 50)}s` }}
              strokeWidth={1.3}
            />
          </div>
        </div>
      </ControlCard>
      {hasCap(device, 'powerLevel') && (
        <SpeedSteps device={device} send={send} disabled={disabled} label="Speed" />
      )}
    </>
  );
}

// ── Simple switch ───────────────────────────────────────────────────────────

function SwitchControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const on = isOn(device);
  return (
    <ControlCard title="Power" subtitle={device.name} device={device} send={send} disabled={disabled}>
      <div className="grid place-items-center py-10">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={on}
          aria-label={on ? 'Turn off' : 'Turn on'}
          onClick={() =>
            send('setPowerState', { state: on ? 'Off' : 'On' }, { powerState: on ? 'Off' : 'On' })
          }
          className={clsx(
            'relative grid size-40 place-items-center rounded-full transition-all duration-300 active:scale-95 disabled:opacity-50',
            on ? 'bg-brand-gradient text-white shadow-float' : 'bg-tint text-subtle',
          )}
        >
          {on && (
            <span className="absolute inset-0 animate-pulse-ring rounded-full border-4 border-brand-300" />
          )}
          <Power className="size-16" strokeWidth={1.8} />
        </button>
        <p className="mt-5 font-semibold text-muted">{on ? 'On' : 'Off'} · tap to switch</p>
      </div>
    </ControlCard>
  );
}

// ── Lock ────────────────────────────────────────────────────────────────────

function LockControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const st = device.state.lockState as string | undefined;
  const locked = st === 'LOCKED';
  return (
    <ControlCard title="Door Lock" subtitle={device.name} device={device} send={send} disabled={disabled}>
      <div className="grid place-items-center py-10">
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            send(
              'setLockState',
              { state: locked ? 'unlock' : 'lock' },
              { lockState: locked ? 'UNLOCKED' : 'LOCKED' },
            )
          }
          className={clsx(
            'grid size-40 place-items-center rounded-full transition active:scale-95 disabled:opacity-50',
            locked ? 'bg-brand-gradient text-white shadow-float' : 'bg-amber-50 text-warning',
          )}
          aria-label={locked ? 'Unlock' : 'Lock'}
        >
          {locked ? <Lock className="size-16" /> : <LockOpen className="size-16" />}
        </button>
        <p className="mt-5 font-semibold">
          {st === 'JAMMED' ? 'Jammed — check the door' : locked ? 'Locked' : 'Unlocked'}
        </p>
        <p className="text-muted text-sm">Tap to {locked ? 'unlock' : 'lock'}</p>
      </div>
    </ControlCard>
  );
}

// ── Blinds / position ───────────────────────────────────────────────────────

function RangeControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const remote = typeof device.state.rangeValue === 'number' ? device.state.rangeValue : 0;
  const [v, setV] = useCommitted(remote, (x) => send('setRangeValue', { rangeValue: x }, { rangeValue: x }));
  return (
    <ControlCard title="Position" subtitle={device.name} device={device} send={send} disabled={disabled}>
      <div className="mx-auto mt-6 h-56 w-48 overflow-hidden rounded-3xl border-8 border-tint bg-brand-50">
        <div
          className="bg-[repeating-linear-gradient(#b6e5f8_0_14px,#7fd2f3_14px_16px)] transition-all duration-300"
          style={{ height: `${100 - v}%` }}
        />
      </div>
      <div className="mt-6 flex items-center gap-3">
        <span className="text-muted text-sm">Closed</span>
        <input
          type="range"
          min={0}
          max={100}
          value={v}
          disabled={disabled}
          aria-label="Open amount"
          onChange={(e) => setV(Number(e.target.value))}
          className="flex-1 accent-brand-500"
        />
        <span className="text-muted text-sm">Open</span>
      </div>
      <p className="mt-2 text-center font-semibold">{v}% open</p>
    </ControlCard>
  );
}

// ── Mode (garage door etc.) ─────────────────────────────────────────────────

function ModeControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const modes = device.config.modes ?? builtinTemplateMap.get(device.type)?.modes ?? [];
  const current = device.state.mode as string | undefined;
  return (
    <ControlCard
      title={builtinTemplateMap.get(device.type)?.name ?? 'Mode'}
      subtitle={device.name}
      device={device}
      send={send}
      disabled={disabled}
    >
      <div className="grid place-items-center py-8">
        <div className="grid size-36 place-items-center rounded-full bg-brand-50 text-brand-500">
          {current === 'Open' ? <DoorOpen className="size-16" /> : <DoorClosed className="size-16" />}
        </div>
        <p className="mt-4 font-semibold text-xl">{current ?? 'Unknown'}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {modes.map((m) => (
          <ModeTile
            key={m}
            label={m}
            icon={<Sparkles className="size-5" />}
            active={current === m}
            disabled={disabled}
            onClick={() => send('setMode', { mode: m }, { mode: m })}
          />
        ))}
      </div>
    </ControlCard>
  );
}

// ── TV / speaker ────────────────────────────────────────────────────────────

function MediaControl({ device, send, disabled }: { device: Device; send: Send; disabled: boolean }) {
  const s = device.state;
  const remote = typeof s.volume === 'number' ? s.volume : 30;
  const [vol, setVol] = useCommitted(remote, (v) => send('setVolume', { volume: v }, { volume: v }));
  const muted = s.mute === true;
  const round =
    'grid size-14 place-items-center rounded-full bg-tint text-ink-soft transition hover:text-brand-600 active:scale-95 disabled:opacity-50';
  return (
    <ControlCard
      title={device.type === 'tv' ? 'TV Remote' : 'Speaker'}
      subtitle={device.name}
      device={device}
      send={send}
      disabled={disabled}
    >
      {hasCap(device, 'mediaControl') && (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            type="button"
            className={round}
            disabled={disabled}
            aria-label="Previous"
            onClick={() => send('mediaControl', { control: 'Previous' })}
          >
            <SkipBack className="size-6" />
          </button>
          <button
            type="button"
            className="grid size-20 place-items-center rounded-full bg-brand-gradient text-white shadow-float active:scale-95"
            disabled={disabled}
            aria-label="Play"
            onClick={() => send('mediaControl', { control: 'Play' })}
          >
            <Play className="size-8" />
          </button>
          <button
            type="button"
            className={round}
            disabled={disabled}
            aria-label="Pause"
            onClick={() => send('mediaControl', { control: 'Pause' })}
          >
            <Pause className="size-6" />
          </button>
          <button
            type="button"
            className={round}
            disabled={disabled}
            aria-label="Next"
            onClick={() => send('mediaControl', { control: 'Next' })}
          >
            <SkipForward className="size-6" />
          </button>
        </div>
      )}
      {hasCap(device, 'volume') && (
        <div className="mt-8 flex items-center gap-3">
          <button
            type="button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            disabled={disabled}
            onClick={() => send('setMute', { mute: !muted }, { mute: !muted })}
            className="text-muted hover:text-brand-600"
          >
            {muted ? <VolumeX className="size-6" /> : <Volume2 className="size-6" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={vol}
            disabled={disabled}
            aria-label="Volume"
            onChange={(e) => setVol(Number(e.target.value))}
            className="flex-1 accent-brand-500"
          />
          <span className="w-10 text-right font-semibold text-sm">{vol}</span>
        </div>
      )}
      {hasCap(device, 'channel') && (
        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            className={round}
            disabled={disabled}
            aria-label="Channel down"
            onClick={() => send('skipChannels', { channelCount: -1 })}
          >
            <ChevronDown className="size-6" />
          </button>
          <span className="font-semibold">Channel</span>
          <button
            type="button"
            className={round}
            disabled={disabled}
            aria-label="Channel up"
            onClick={() => send('skipChannels', { channelCount: 1 })}
          >
            <ChevronUp className="size-6" />
          </button>
        </div>
      )}
      {hasCap(device, 'inputController') && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {['HDMI 1', 'HDMI 2', 'TV', 'Bluetooth', 'AUX'].map((i) => (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => send('selectInput', { input: i }, { input: i })}
              className={clsx(
                'h-10 rounded-full px-4 font-semibold text-sm',
                s.input === i ? 'bg-brand-gradient text-white' : 'bg-tint text-ink-soft',
              )}
            >
              {i}
            </button>
          ))}
        </div>
      )}
    </ControlCard>
  );
}

// ── Read-only sensors ───────────────────────────────────────────────────────

function Reading({ label, value, unit }: { label: string; value: unknown; unit: string }) {
  if (typeof value !== 'number') return null;
  return (
    <div className="rounded-tile bg-tint p-4">
      <div className="text-muted text-sm">{label}</div>
      <div className="font-bold text-3xl text-brand-600">
        {value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
        <span className="ml-1 font-medium text-base text-muted">{unit}</span>
      </div>
    </div>
  );
}

function SensorControl({ device }: { device: Device }) {
  const s = device.state;
  const event = hasCap(device, 'doorbell') ? (
    <Status
      icon={<BellRing className="size-14" />}
      label={s.lastRingAt ? `Last ring ${timeAgo(s.lastRingAt as string)}` : 'No rings yet'}
    />
  ) : hasCap(device, 'motion') ? (
    <Status
      icon={<Radar className="size-14" />}
      label={s.motion === 'detected' ? 'Motion detected' : 'All quiet'}
      active={s.motion === 'detected'}
    />
  ) : hasCap(device, 'contact') ? (
    <Status
      icon={s.contact === 'open' ? <DoorOpen className="size-14" /> : <DoorClosed className="size-14" />}
      label={s.contact === 'open' ? 'Open' : 'Closed'}
      active={s.contact === 'open'}
    />
  ) : null;

  return (
    <Card>
      <h2 className="font-bold text-2xl sm:text-3xl">
        {builtinTemplateMap.get(device.type)?.name ?? 'Sensor'}
      </h2>
      <p className="text-muted text-sm">{device.name}</p>
      {event}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Reading label="Temperature" value={s.temperature} unit="°C" />
        <Reading label="Humidity" value={s.humidity} unit="%" />
        <Reading label="PM2.5" value={s.pm25} unit="µg/m³" />
        <Reading label="PM10" value={s.pm10} unit="µg/m³" />
        <Reading label="Power" value={s.power} unit="W" />
        <Reading label="Voltage" value={s.voltage} unit="V" />
        <Reading label="Current" value={s.current} unit="A" />
      </div>
    </Card>
  );
}

function Status({ icon, label, active }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <div className="grid place-items-center py-8 text-center">
      <div
        className={clsx(
          'grid size-32 place-items-center rounded-full',
          active ? 'bg-brand-gradient text-white shadow-float' : 'bg-brand-50 text-brand-500',
        )}
      >
        {icon}
      </div>
      <p className="mt-4 font-semibold text-lg">{label}</p>
    </div>
  );
}

// ── Registry ────────────────────────────────────────────────────────────────

/** Pick the right control surface for a device from its capabilities (works for custom templates too). */
export function DeviceControls({ device }: { device: Device }) {
  const act = useDeviceAction(device);
  const disabled = !!device.controllerId && !device.online;
  const send: Send = (action, value, optimistic) => act.mutate({ action, value, optimistic });
  const props = { device, send, disabled };

  if (hasCap(device, 'thermostat')) return <ClimateControl {...props} />;
  if (hasCap(device, 'lock')) return <LockControl {...props} />;
  if (
    hasCap(device, 'brightness') ||
    (hasCap(device, 'powerLevel') && ['dimSwitch', 'light'].includes(device.type))
  )
    return <LightControl {...props} />;
  if (hasCap(device, 'volume') || hasCap(device, 'mediaControl')) return <MediaControl {...props} />;
  if (hasCap(device, 'rangeValue')) return <RangeControl {...props} />;
  if (hasCap(device, 'mode')) return <ModeControl {...props} />;
  if (device.type === 'fan' || hasCap(device, 'powerLevel')) return <FanControl {...props} />;
  if (hasCap(device, 'powerState')) return <SwitchControl {...props} />;
  return <SensorControl device={device} />;
}
