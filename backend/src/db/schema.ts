/**
 * Drizzle mappings for typed queries. DDL lives in ./migrations/*.sql (hand-written so partitioned
 * tables, enums and partial indexes are exact); keep both in sync.
 */
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const homeRole = pgEnum('home_role', ['owner', 'admin', 'member']);
export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify', 'reset']);
export const deviceEventKind = pgEnum('device_event_kind', [
  'command',
  'response',
  'event',
  'online',
  'offline',
]);
export const eventSource = pgEnum('event_source', [
  'app',
  'api',
  'scene',
  'schedule',
  'automation',
  'physical',
  'restore',
  'system',
  'local',
]);
export const otaTargetStatus = pgEnum('ota_target_status', [
  'pending',
  'offered',
  'downloading',
  'installing',
  'succeeded',
  'failed',
  'timeout',
]);
export type HomeRole = (typeof homeRole.enumValues)[number];

/** What plain members of a home may do. Owners and admins can always do everything. */
export interface MemberPermissions {
  locks: boolean;
  energy: boolean;
  lighting: boolean;
  climate: boolean;
}

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  emailVerifiedAt: ts('email_verified_at'),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  tokenHash: text('token_hash').notNull(),
  familyId: uuid('family_id').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  replacedBy: uuid('replaced_by'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastUsedAt: ts('last_used_at'),
});

export const emailTokens = pgTable('email_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  purpose: emailTokenPurpose('purpose').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  lastUsedAt: ts('last_used_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: ts('at').notNull().defaultNow(),
  actorUserId: uuid('actor_user_id'),
  actorApiKeyId: uuid('actor_api_key_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ip: inet('ip'),
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
});

export const homes = pgTable('homes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  tariffPerKwh: numeric('tariff_per_kwh', { mode: 'number' }).notNull().default(8),
  currency: text('currency').notNull().default('INR'),
  memberPermissions: jsonb('member_permissions')
    .$type<MemberPermissions>()
    .notNull()
    .default({ locks: true, energy: true, lighting: true, climate: true }),
  /** Local-control PIN, AES-GCM with SECRET_ENC_KEY. Null = local control off. Never sent to clients. */
  localPinEnc: bytea('local_pin_enc'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const homeMembers = pgTable(
  'home_members',
  {
    homeId: uuid('home_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: homeRole('role').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.homeId, t.userId] })],
);

export const homeInvites = pgTable('home_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  email: citext('email').notNull(),
  role: homeRole('role').notNull(),
  tokenHash: text('token_hash').notNull(),
  invitedBy: uuid('invited_by'),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('sofa'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const deviceTemplates = pgTable('device_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id'),
  key: text('key').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('box'),
  capabilities: jsonb('capabilities').$type<string[]>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const controllers = pgTable('controllers', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  name: text('name').notNull(),
  keyId: text('key_id').notNull(),
  secretEnc: bytea('secret_enc').notNull(),
  model: text('model'),
  mac: text('mac'),
  firmwareVersion: text('firmware_version'),
  ip: inet('ip'),
  /** Address on the home network and mDNS name, for the board's local control page. */
  lanIp: inet('lan_ip'),
  localName: text('local_name'),
  online: boolean('online').notNull().default(false),
  lastSeenAt: ts('last_seen_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export interface DeviceConfig {
  ratedWatts?: number;
  powerOnBehavior?: 'off' | 'last' | 'cloud';
  modes?: string[];
}

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  roomId: uuid('room_id'),
  controllerId: uuid('controller_id'),
  channel: smallint('channel'),
  type: text('type').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('box'),
  capabilities: jsonb('capabilities').$type<string[]>().notNull(),
  config: jsonb('config').$type<DeviceConfig>().notNull().default({}),
  favorite: boolean('favorite').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const deviceState = pgTable('device_state', {
  deviceId: uuid('device_id').primaryKey(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  powerOnSince: ts('power_on_since'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const deviceEvents = pgTable('device_events', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
  at: ts('at').notNull().defaultNow(),
  homeId: uuid('home_id').notNull(),
  deviceId: uuid('device_id'),
  controllerId: uuid('controller_id'),
  kind: deviceEventKind('kind').notNull(),
  action: text('action'),
  value: jsonb('value').$type<Record<string, unknown>>(),
  source: eventSource('source').notNull(),
  actorUserId: uuid('actor_user_id'),
  success: boolean('success'),
  message: text('message'),
});

export const sensorReadings = pgTable('sensor_readings', {
  deviceId: uuid('device_id').notNull(),
  metric: smallint('metric').notNull(),
  ts: ts('ts').notNull(),
  value: doublePrecision('value').notNull(),
});

export const sensorRollupsHourly = pgTable(
  'sensor_rollups_hourly',
  {
    deviceId: uuid('device_id').notNull(),
    metric: smallint('metric').notNull(),
    hour: ts('hour').notNull(),
    min: doublePrecision('min').notNull(),
    max: doublePrecision('max').notNull(),
    avg: doublePrecision('avg').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.metric, t.hour] })],
);

export const energyDaily = pgTable(
  'energy_daily',
  {
    deviceId: uuid('device_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    onSeconds: integer('on_seconds').notNull().default(0),
    whEstimated: numeric('wh_estimated', { mode: 'number' }).notNull().default(0),
    whMeasured: numeric('wh_measured', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.day] })],
);

export interface ActionStep {
  deviceId: string;
  action: string;
  value: Record<string, unknown>;
}

export const scenes = pgTable('scenes', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('sparkles'),
  actions: jsonb('actions').$type<ActionStep[]>().notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const automations = pgTable('automations', {
  id: uuid('id').primaryKey().defaultRandom(),
  homeId: uuid('home_id').notNull(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  trigger: jsonb('trigger').$type<Record<string, unknown>>().notNull(),
  conditions: jsonb('conditions').$type<Record<string, unknown>[]>().notNull().default([]),
  actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull(),
  endActions: jsonb('end_actions').$type<Record<string, unknown>[]>().notNull().default([]),
  cooldownS: integer('cooldown_s').notNull().default(5),
  nextRunAt: ts('next_run_at'),
  nextEdge: text('next_edge'),
  lastRunAt: ts('last_run_at'),
  lastStatus: text('last_status'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const automationRuns = pgTable('automation_runs', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  automationId: uuid('automation_id').notNull(),
  at: ts('at').notNull().defaultNow(),
  triggerInfo: jsonb('trigger_info').$type<Record<string, unknown>>(),
  status: text('status').notNull(),
  results: jsonb('results').$type<unknown[]>(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  homeId: uuid('home_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notificationPrefs = pgTable(
  'notification_prefs',
  {
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    push: boolean('push').notNull().default(true),
    email: boolean('email').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  lastSuccessAt: ts('last_success_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const firmwareReleases = pgTable('firmware_releases', {
  id: uuid('id').primaryKey().defaultRandom(),
  model: text('model').notNull(),
  version: text('version').notNull(),
  filePath: text('file_path').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  notes: text('notes').notNull().default(''),
  uploadedBy: uuid('uploaded_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const otaRollouts = pgTable('ota_rollouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  releaseId: uuid('release_id').notNull(),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const otaTargets = pgTable(
  'ota_targets',
  {
    rolloutId: uuid('rollout_id').notNull(),
    controllerId: uuid('controller_id').notNull(),
    status: otaTargetStatus('status').notNull().default('pending'),
    progress: smallint('progress').notNull().default(0),
    error: text('error'),
    offeredAt: ts('offered_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.rolloutId, t.controllerId] })],
);
