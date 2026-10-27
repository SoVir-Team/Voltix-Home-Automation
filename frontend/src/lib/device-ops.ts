import { builtinTemplateMap } from '@voltix/protocol';
import type { Device } from './types';

/**
 * Human-sized commands a scene or automation can send to a device, derived from its capabilities.
 * Each op maps to one protocol action; `input` ops carry one number or choice.
 */
export interface DeviceOp {
  id: string;
  label: string;
  action: string;
  fixed?: Record<string, unknown>;
  input?: {
    key: string;
    min?: number;
    max?: number;
    unit?: string;
    choices?: string[];
    initial: number | string;
  };
}

const thermostatModes = ['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN', 'ECO', 'OFF'];

export function opsFor(d: Device): DeviceOp[] {
  const has = (c: string) => d.capabilities.includes(c);
  const ops: DeviceOp[] = [];
  if (has('powerState'))
    ops.push(
      { id: 'on', label: 'Turn on', action: 'setPowerState', fixed: { state: 'On' } },
      { id: 'off', label: 'Turn off', action: 'setPowerState', fixed: { state: 'Off' } },
    );
  if (has('brightness'))
    ops.push({
      id: 'brightness',
      label: 'Set brightness',
      action: 'setBrightness',
      input: { key: 'brightness', min: 0, max: 100, unit: '%', initial: 70 },
    });
  if (has('powerLevel'))
    ops.push({
      id: 'powerLevel',
      label: d.type === 'fan' ? 'Set speed' : 'Set level',
      action: 'setPowerLevel',
      input: { key: 'powerLevel', min: 0, max: 100, unit: '%', initial: 50 },
    });
  if (has('rangeValue'))
    ops.push({
      id: 'rangeValue',
      label: 'Set position',
      action: 'setRangeValue',
      input: { key: 'rangeValue', min: 0, max: 100, unit: '%', initial: 100 },
    });
  if (has('thermostat'))
    ops.push(
      {
        id: 'temp',
        label: 'Set temperature',
        action: 'targetTemperature',
        input: { key: 'temperature', min: 16, max: 30, unit: '°C', initial: 24 },
      },
      {
        id: 'tmode',
        label: 'Set mode',
        action: 'setThermostatMode',
        input: { key: 'thermostatMode', choices: thermostatModes, initial: 'COOL' },
      },
    );
  if (has('lock'))
    ops.push(
      { id: 'lock', label: 'Lock', action: 'setLockState', fixed: { state: 'lock' } },
      { id: 'unlock', label: 'Unlock', action: 'setLockState', fixed: { state: 'unlock' } },
    );
  if (has('mode')) {
    const modes = d.config.modes ?? builtinTemplateMap.get(d.type)?.modes ?? [];
    if (modes.length)
      ops.push({
        id: 'mode',
        label: 'Set mode',
        action: 'setMode',
        input: { key: 'mode', choices: modes, initial: modes[0]! },
      });
  }
  if (has('volume'))
    ops.push({
      id: 'volume',
      label: 'Set volume',
      action: 'setVolume',
      input: { key: 'volume', min: 0, max: 100, unit: '%', initial: 30 },
    });
  return ops;
}

/** Find the op a saved {action, value} step came from. */
export function matchOp(d: Device, action: string, value: Record<string, unknown>): DeviceOp | undefined {
  return opsFor(d).find(
    (o) => o.action === action && (!o.fixed || Object.entries(o.fixed).every(([k, v]) => value[k] === v)),
  );
}

export function opValue(op: DeviceOp, input?: number | string): Record<string, unknown> {
  return op.fixed ?? { [op.input!.key]: input ?? op.input!.initial };
}

/** State a device trigger can watch. `changed` keys (doorbell) fire on every new value. */
export interface WatchKey {
  key: string;
  label: string;
  unit?: string;
  choices?: { value: string; label: string }[];
  changed?: boolean;
}

export function watchKeysFor(d: Device): WatchKey[] {
  const has = (c: string) => d.capabilities.includes(c);
  const keys: WatchKey[] = [];
  if (has('powerState'))
    keys.push({
      key: 'powerState',
      label: 'Turns',
      choices: [
        { value: 'On', label: 'on' },
        { value: 'Off', label: 'off' },
      ],
    });
  if (has('motion'))
    keys.push({
      key: 'motion',
      label: 'Motion',
      choices: [
        { value: 'detected', label: 'detected' },
        { value: 'notDetected', label: 'stops' },
      ],
    });
  if (has('contact'))
    keys.push({
      key: 'contact',
      label: 'Door/window',
      choices: [
        { value: 'open', label: 'opens' },
        { value: 'closed', label: 'closes' },
      ],
    });
  if (has('lock'))
    keys.push({
      key: 'lockState',
      label: 'Lock',
      choices: [
        { value: 'LOCKED', label: 'locks' },
        { value: 'UNLOCKED', label: 'unlocks' },
        { value: 'JAMMED', label: 'jams' },
      ],
    });
  if (has('doorbell')) keys.push({ key: 'lastRingAt', label: 'Doorbell rings', changed: true });
  if (has('temperatureSensor') || has('thermostat'))
    keys.push({ key: 'temperature', label: 'Temperature', unit: '°C' });
  if (has('temperatureSensor')) keys.push({ key: 'humidity', label: 'Humidity', unit: '%' });
  if (has('powerSensor')) keys.push({ key: 'power', label: 'Power draw', unit: 'W' });
  if (has('airQuality')) keys.push({ key: 'pm25', label: 'PM2.5', unit: 'µg/m³' });
  return keys;
}

/** "Turn on", "Set brightness 70%", "Set mode COOL". */
export function describeStep(d: Device | undefined, action: string, value: Record<string, unknown>): string {
  if (!d) return 'Removed device';
  const op = matchOp(d, action, value);
  if (!op) return action;
  if (op.fixed) return op.label;
  const v = value[op.input!.key];
  return `${op.label} ${v}${op.input!.unit ?? ''}`;
}
