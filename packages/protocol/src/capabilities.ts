import { z } from 'zod';

/**
 * Capability registry: the single source of truth for what devices can do.
 * Drives backend validation, device-state updates, telemetry extraction, UI controls and firmware snippets.
 *
 * Each action's `value` schema validates both the cloud -> device request and the device's response
 * (devices answer with the resulting absolute value). `state` maps a value to device-state keys.
 */

export type DeviceState = Record<string, unknown>;

export const metrics = {
  temperature: 1,
  humidity: 2,
  pm1: 3,
  pm25: 4,
  pm10: 5,
  power: 6,
  voltage: 7,
  current: 8,
  energyWh: 9,
} as const;
export type MetricName = keyof typeof metrics;
export const metricNames = Object.keys(metrics) as MetricName[];
export const metricUnits: Record<MetricName, string> = {
  temperature: '°C',
  humidity: '%',
  pm1: 'µg/m³',
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  power: 'W',
  voltage: 'V',
  current: 'A',
  energyWh: 'Wh',
};

interface ActionDef {
  value: z.ZodType<Record<string, unknown>>;
  state: (value: Record<string, unknown>) => DeviceState;
}
interface EventDef extends ActionDef {
  /** Numeric readings to store as telemetry. */
  readings?: (value: Record<string, unknown>) => Partial<Record<MetricName, number>>;
  /** Event is worth notifying users about (doorbell, motion, contact). */
  notify?: (value: Record<string, unknown>) => string | null;
}
export interface CapabilityDef {
  label: string;
  /** cloud -> device actions. */
  actions: Record<string, ActionDef>;
  /** device -> cloud events. State-changing actions are also accepted as events (physical switch). */
  events: Record<string, EventDef>;
}

const pct = z.number().int().min(0).max(100);
const delta = z.number().int().min(-100).max(100);
const temp = z.number().min(-40).max(125);
const pick =
  <K extends string>(...keys: K[]) =>
  (v: Record<string, unknown>) =>
    Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));

const powerStateValue = z.object({ state: z.enum(['On', 'Off']) });
const brightnessValue = z.object({ brightness: pct });
const powerLevelValue = z.object({ powerLevel: pct });
const rangeValue = z.object({ rangeValue: z.number().int().min(0).max(100) });
const lockValue = z.object({ state: z.enum(['lock', 'unlock']) });
const lockStateValue = z.object({ state: z.enum(['LOCKED', 'UNLOCKED', 'JAMMED']) });
const tempHumidity = z.object({ temperature: temp, humidity: z.number().min(0).max(100).optional() });

export const capabilities = {
  powerState: {
    label: 'Power',
    actions: {
      setPowerState: { value: powerStateValue, state: (v) => ({ powerState: v.state }) },
    },
    events: {
      setPowerState: { value: powerStateValue, state: (v) => ({ powerState: v.state }) },
    },
  },
  brightness: {
    label: 'Brightness',
    actions: {
      setBrightness: { value: brightnessValue, state: pick('brightness') },
      adjustBrightness: { value: z.object({ brightnessDelta: delta }), state: pick('brightness') },
    },
    events: { setBrightness: { value: brightnessValue, state: pick('brightness') } },
  },
  color: {
    label: 'Colour',
    actions: {
      setColor: {
        value: z.object({
          color: z.object({
            r: z.number().int().min(0).max(255),
            g: z.number().int().min(0).max(255),
            b: z.number().int().min(0).max(255),
          }),
        }),
        state: pick('color'),
      },
    },
    events: {},
  },
  colorTemperature: {
    label: 'Colour temperature',
    actions: {
      setColorTemperature: {
        value: z.object({ colorTemperature: z.number().int().min(2200).max(7000) }),
        state: pick('colorTemperature'),
      },
    },
    events: {},
  },
  powerLevel: {
    label: 'Speed / level',
    actions: {
      setPowerLevel: { value: powerLevelValue, state: pick('powerLevel') },
      adjustPowerLevel: { value: z.object({ powerLevelDelta: delta }), state: pick('powerLevel') },
    },
    events: { setPowerLevel: { value: powerLevelValue, state: pick('powerLevel') } },
  },
  rangeValue: {
    label: 'Position',
    actions: { setRangeValue: { value: rangeValue, state: pick('rangeValue') } },
    events: { setRangeValue: { value: rangeValue, state: pick('rangeValue') } },
  },
  thermostat: {
    label: 'Thermostat',
    actions: {
      setThermostatMode: {
        value: z.object({ thermostatMode: z.enum(['AUTO', 'COOL', 'HEAT', 'DRY', 'FAN', 'ECO', 'OFF']) }),
        state: pick('thermostatMode'),
      },
      targetTemperature: {
        value: z.object({ temperature: z.number().min(5).max(40) }),
        state: (v) => ({ targetTemperature: v.temperature }),
      },
    },
    events: {},
  },
  temperatureSensor: {
    label: 'Temperature',
    actions: {},
    events: {
      currentTemperature: {
        value: tempHumidity,
        state: (v) => ({
          temperature: v.temperature,
          ...(v.humidity !== undefined && { humidity: v.humidity }),
        }),
        readings: (v) => ({
          temperature: v.temperature as number,
          humidity: v.humidity as number | undefined,
        }),
      },
    },
  },
  lock: {
    label: 'Lock',
    actions: {
      setLockState: {
        value: z.union([lockValue, lockStateValue]),
        state: (v) => ({
          lockState:
            String(v.state).toUpperCase() === 'LOCK'
              ? 'LOCKED'
              : String(v.state).toUpperCase() === 'UNLOCK'
                ? 'UNLOCKED'
                : v.state,
        }),
      },
    },
    events: {
      setLockState: { value: lockStateValue, state: (v) => ({ lockState: v.state }) },
    },
  },
  mode: {
    label: 'Mode',
    actions: {
      setMode: { value: z.object({ mode: z.string().min(1).max(32) }), state: pick('mode') },
    },
    events: { setMode: { value: z.object({ mode: z.string().min(1).max(32) }), state: pick('mode') } },
  },
  volume: {
    label: 'Volume',
    actions: {
      setVolume: { value: z.object({ volume: pct }), state: pick('volume') },
      setMute: { value: z.object({ mute: z.boolean() }), state: pick('mute') },
    },
    events: {},
  },
  mediaControl: {
    label: 'Media',
    actions: {
      mediaControl: {
        value: z.object({
          control: z.enum(['Play', 'Pause', 'Stop', 'Next', 'Previous', 'Rewind', 'FastForward']),
        }),
        state: () => ({}),
      },
    },
    events: {},
  },
  inputController: {
    label: 'Input',
    actions: {
      selectInput: { value: z.object({ input: z.string().min(1).max(32) }), state: pick('input') },
    },
    events: {},
  },
  channel: {
    label: 'Channel',
    actions: {
      changeChannel: {
        value: z.object({ channel: z.object({ number: z.number().int().min(0).max(9999) }) }),
        state: pick('channel'),
      },
      skipChannels: {
        value: z.object({ channelCount: z.number().int().min(-99).max(99) }),
        state: pick('channel'),
      },
    },
    events: {},
  },
  doorbell: {
    label: 'Doorbell',
    actions: {},
    events: {
      DoorbellPress: {
        value: z.object({ state: z.literal('pressed') }),
        state: () => ({ lastRingAt: new Date().toISOString() }),
        notify: () => 'Someone is at the door',
      },
    },
  },
  motion: {
    label: 'Motion',
    actions: {},
    events: {
      motion: {
        value: z.object({ state: z.enum(['detected', 'notDetected']) }),
        state: (v) => ({ motion: v.state }),
        notify: (v) => (v.state === 'detected' ? 'Motion detected' : null),
      },
    },
  },
  contact: {
    label: 'Contact',
    actions: {},
    events: {
      setContactState: {
        value: z.object({ state: z.enum(['open', 'closed']) }),
        state: (v) => ({ contact: v.state }),
        notify: (v) => (v.state === 'open' ? 'Opened' : null),
      },
    },
  },
  airQuality: {
    label: 'Air quality',
    actions: {},
    events: {
      airQuality: {
        value: z.object({
          pm1: z.number().min(0).max(5000),
          pm2_5: z.number().min(0).max(5000),
          pm10: z.number().min(0).max(5000),
        }),
        state: (v) => ({ pm1: v.pm1, pm25: v.pm2_5, pm10: v.pm10 }),
        readings: (v) => ({ pm1: v.pm1 as number, pm25: v.pm2_5 as number, pm10: v.pm10 as number }),
      },
    },
  },
  powerSensor: {
    label: 'Power meter',
    actions: {},
    events: {
      powerUsage: {
        value: z.object({
          power: z.number().min(0).max(100_000),
          voltage: z.number().min(0).max(1000).optional(),
          current: z.number().min(0).max(1000).optional(),
          wattHours: z.number().min(0).optional(),
        }),
        state: pick('power', 'voltage', 'current'),
        readings: (v) => ({
          power: v.power as number,
          voltage: v.voltage as number | undefined,
          current: v.current as number | undefined,
          energyWh: v.wattHours as number | undefined,
        }),
      },
    },
  },
} satisfies Record<string, CapabilityDef>;

export type CapabilityName = keyof typeof capabilities;
export const capabilityNames = Object.keys(capabilities) as CapabilityName[];

export function isCapability(name: string): name is CapabilityName {
  return Object.hasOwn(capabilities, name);
}

/** Find the definition of an action among a device's capabilities. */
export function findAction(caps: readonly string[], action: string): ActionDef | undefined {
  for (const c of caps) {
    if (!isCapability(c)) continue;
    const def = (capabilities[c] as CapabilityDef).actions[action];
    if (def) return def;
  }
  return undefined;
}

export function findEvent(caps: readonly string[], action: string): EventDef | undefined {
  for (const c of caps) {
    if (!isCapability(c)) continue;
    const def = (capabilities[c] as CapabilityDef).events[action];
    if (def) return def;
  }
  return undefined;
}

/** Every action a set of capabilities accepts, for docs and UI. */
export function actionsFor(caps: readonly string[]): string[] {
  return caps.flatMap((c) =>
    isCapability(c) ? Object.keys((capabilities[c] as CapabilityDef).actions) : [],
  );
}
