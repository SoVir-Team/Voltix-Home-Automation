import type { CapabilityName } from './capabilities';

export interface DeviceTemplate {
  key: string;
  name: string;
  /** lucide icon name used by the web app. */
  icon: string;
  capabilities: CapabilityName[];
  /** Typical rated power for energy estimation (W); user can override per device. */
  defaultWatts?: number;
  /** Values a mode capability offers (e.g. garage door). */
  modes?: string[];
  /** Light/scene presets shown on the device page. */
  presets?: { name: string; icon: string; actions: { action: string; value: Record<string, unknown> }[] }[];
}

const lightPresets: DeviceTemplate['presets'] = [
  { name: 'Prayer', icon: 'lightbulb', actions: [{ action: 'setBrightness', value: { brightness: 60 } }] },
  { name: 'Night', icon: 'moon', actions: [{ action: 'setBrightness', value: { brightness: 15 } }] },
  { name: 'Movie', icon: 'clapperboard', actions: [{ action: 'setBrightness', value: { brightness: 30 } }] },
  { name: 'Party', icon: 'party-popper', actions: [{ action: 'setBrightness', value: { brightness: 100 } }] },
];

/** Built-in device types (Sinric-equivalent). Custom templates are stored in the database. */
export const builtinTemplates: DeviceTemplate[] = [
  { key: 'switch', name: 'Switch', icon: 'toggle-right', capabilities: ['powerState'], defaultWatts: 60 },
  {
    key: 'dimSwitch',
    name: 'Dimmable switch',
    icon: 'sun-dim',
    capabilities: ['powerState', 'powerLevel'],
    defaultWatts: 60,
    presets: lightPresets,
  },
  {
    key: 'light',
    name: 'Smart light',
    icon: 'lightbulb',
    capabilities: ['powerState', 'brightness', 'color', 'colorTemperature'],
    defaultWatts: 10,
    presets: lightPresets,
  },
  { key: 'fan', name: 'Fan', icon: 'fan', capabilities: ['powerState', 'powerLevel'], defaultWatts: 75 },
  {
    key: 'thermostat',
    name: 'Thermostat',
    icon: 'thermometer',
    capabilities: ['powerState', 'thermostat', 'temperatureSensor'],
    defaultWatts: 0,
  },
  {
    key: 'windowAC',
    name: 'Air conditioner',
    icon: 'air-vent',
    capabilities: ['powerState', 'thermostat', 'powerLevel', 'temperatureSensor'],
    defaultWatts: 1500,
  },
  {
    key: 'tv',
    name: 'TV',
    icon: 'tv',
    capabilities: ['powerState', 'volume', 'mediaControl', 'inputController', 'channel'],
    defaultWatts: 100,
  },
  {
    key: 'speaker',
    name: 'Speaker',
    icon: 'speaker',
    capabilities: ['powerState', 'volume', 'mediaControl', 'inputController'],
    defaultWatts: 20,
  },
  { key: 'lock', name: 'Smart lock', icon: 'lock', capabilities: ['lock'] },
  {
    key: 'garageDoor',
    name: 'Garage door',
    icon: 'warehouse',
    capabilities: ['mode'],
    modes: ['Open', 'Close'],
  },
  {
    key: 'blinds',
    name: 'Blinds',
    icon: 'blinds',
    capabilities: ['powerState', 'rangeValue'],
    defaultWatts: 30,
  },
  { key: 'doorbell', name: 'Doorbell', icon: 'bell-ring', capabilities: ['doorbell'] },
  { key: 'motionSensor', name: 'Motion sensor', icon: 'radar', capabilities: ['motion'] },
  { key: 'contactSensor', name: 'Door / window sensor', icon: 'door-open', capabilities: ['contact'] },
  {
    key: 'temperatureSensor',
    name: 'Temperature sensor',
    icon: 'thermometer-sun',
    capabilities: ['temperatureSensor'],
  },
  { key: 'airQualitySensor', name: 'Air quality sensor', icon: 'wind', capabilities: ['airQuality'] },
  { key: 'powerSensor', name: 'Energy meter', icon: 'gauge', capabilities: ['powerSensor'] },
];

export const builtinTemplateMap: ReadonlyMap<string, DeviceTemplate> = new Map(
  builtinTemplates.map((t) => [t.key, t]),
);
