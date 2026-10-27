/** Shapes returned by the Voltix API (dates arrive as ISO strings). */

export type HomeRole = 'owner' | 'admin' | 'member';
export type DeviceState = Record<string, unknown>;

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
}

export interface MemberPermissions {
  locks: boolean;
  energy: boolean;
  lighting: boolean;
  climate: boolean;
}

export interface Home {
  id: string;
  name: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  tariffPerKwh: number;
  currency: string;
  memberPermissions: MemberPermissions;
  /** A home PIN is set, so boards serve their local control page on the home Wi-Fi. */
  localPinSet: boolean;
  role: HomeRole;
  /** Present in the GET /homes list. */
  deviceCount?: number;
  createdAt: string;
}

export interface Room {
  id: string;
  homeId: string;
  name: string;
  icon: string;
  sortOrder: number;
  deviceCount: number;
}

export interface DeviceConfig {
  ratedWatts?: number;
  powerOnBehavior?: 'off' | 'last' | 'cloud';
  modes?: string[];
}

export interface Device {
  id: string;
  homeId: string;
  roomId: string | null;
  controllerId: string | null;
  channel: number | null;
  type: string;
  name: string;
  icon: string;
  capabilities: string[];
  config: DeviceConfig;
  favorite: boolean;
  sortOrder: number;
  state: DeviceState;
  stateUpdatedAt: string | null;
  online: boolean;
}

export interface Controller {
  id: string;
  homeId: string;
  name: string;
  keyId: string;
  model: string | null;
  mac: string | null;
  firmwareVersion: string | null;
  ip: string | null;
  /** Where the board's local control page is on the home Wi-Fi (reported by the board). */
  lanIp: string | null;
  localName: string | null;
  online: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  deviceCount?: number;
}

export interface ActivityEvent {
  id: number;
  at: string;
  kind: 'response' | 'event' | 'online' | 'offline';
  action: string | null;
  value: Record<string, unknown> | null;
  source: string;
  success: boolean | null;
  message: string | null;
  deviceId: string | null;
  controllerId: string | null;
  deviceName: string | null;
  actorName: string | null;
}

export interface SceneStep {
  deviceId: string;
  action: string;
  value: Record<string, unknown>;
}

export interface Scene {
  id: string;
  homeId: string;
  name: string;
  icon: string | null;
  actions: SceneStep[];
  createdAt: string;
}

export type Trigger =
  | { kind: 'time'; cron: string }
  | { kind: 'sun'; event: 'sunrise' | 'sunset'; offsetMin: number; days?: number[] }
  | { kind: 'once'; at: string }
  | { kind: 'window'; start: string; end: string; days?: number[] }
  | {
      kind: 'device';
      deviceId: string;
      key: string;
      op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'changed';
      value?: string | number | boolean;
      hysteresis?: number;
    };

export type Condition =
  | { kind: 'timeWindow'; from: string; to: string }
  | { kind: 'days'; days: number[] }
  | { kind: 'device'; deviceId: string; key: string; op: string; value: string | number | boolean };

export type AutomationAction =
  | { kind: 'device'; deviceId: string; action: string; value: Record<string, unknown> }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'notify'; title: string; body: string }
  | { kind: 'delay'; seconds: number };

export interface Automation {
  id: string;
  homeId: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  actions: AutomationAction[];
  endActions: AutomationAction[] | null;
  cooldownS: number;
  nextRunAt: string | null;
  createdAt: string;
}

export interface AutomationRun {
  id: string;
  at: string;
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  triggerInfo: Record<string, unknown>;
  results: unknown[];
}

export interface EnergyReport {
  range: 'week' | 'month' | 'year';
  currency: string;
  tariffPerKwh: number;
  totalKwh: number;
  cost: number;
  previousKwh: number;
  changePct: number | null;
  series: { period: string; kwh: number }[];
  devices: { id: string; name: string; type: string; icon: string; kwh: number }[];
}

export interface HistoryPoint {
  t: number;
  v: number;
  min?: number;
  max?: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: HomeRole;
  joinedAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: HomeRole;
  expiresAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  homeId: string | null;
  deviceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPref {
  type: string;
  inApp: boolean;
  push: boolean;
  email: boolean;
}

export interface Template {
  id?: string;
  key: string;
  name: string;
  icon: string;
  capabilities: string[];
  builtin: boolean;
  defaultWatts?: number;
  modes?: string[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface FirmwareRelease {
  id: string;
  model: string;
  version: string;
  size: number;
  sha256: string;
  notes: string;
  createdAt: string;
}

export interface Rollout {
  id: string;
  releaseId: string;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
  model: string;
  version: string;
  total: number;
  counts: Record<string, number>;
}

/** Messages pushed on the realtime socket. */
export type RealtimeEvent =
  | { type: 'subscribed'; homeId: string }
  | { type: 'device.state'; deviceId: string; state: DeviceState }
  | { type: 'device.online'; controllerId: string; online: boolean }
  | { type: 'device.changed'; deviceId: string }
  | { type: 'notification.new'; notification: AppNotification }
  | { type: 'automation.run'; automationId: string; status: string }
  | { type: 'ota.progress'; controllerId: string; rolloutId: string; status: string; progress: number }
  | { type: 'pong' }
  | { type: 'error'; message: string };
