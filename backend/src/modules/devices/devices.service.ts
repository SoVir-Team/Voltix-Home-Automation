import {
  controllerActions,
  EVENT_BURST,
  EVENT_REFILL_PER_S,
  findAction,
  findEvent,
  metrics,
  type Payload,
  TELEMETRY_MIN_INTERVAL_S,
} from '@voltix/protocol/node';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../../context';
import {
  controllers,
  deviceEvents,
  deviceState,
  devices,
  type MemberPermissions,
  sensorReadings,
} from '../../db/schema';
import { AppError, badRequest } from '../../lib/errors';
import type { ControllerAuth, HandshakeMeta } from '../gateway/gateway';
import { resolveTemplate } from '../templates/templates.service';
import { applyState, type Device, type Source } from './state.service';

/** Which member-permission area controls a device type. */
export function permissionArea(type: string): keyof MemberPermissions | null {
  if (type === 'lock' || type === 'garageDoor') return 'locks';
  if (['light', 'dimSwitch', 'switch'].includes(type)) return 'lighting';
  if (['thermostat', 'windowAC', 'fan'].includes(type)) return 'climate';
  return null;
}

export async function deviceViews(ctx: AppContext, where: ReturnType<typeof eq>) {
  const rows = await ctx.db
    .select({
      device: devices,
      state: deviceState.state,
      updatedAt: deviceState.updatedAt,
      online: controllers.online,
    })
    .from(devices)
    .leftJoin(deviceState, eq(deviceState.deviceId, devices.id))
    .leftJoin(controllers, eq(controllers.id, devices.controllerId))
    .where(where)
    .orderBy(asc(devices.sortOrder), asc(devices.createdAt));
  return rows.map((r) => ({
    ...r.device,
    state: r.state ?? {},
    stateUpdatedAt: r.updatedAt,
    online: r.device.controllerId ? ctx.services.gateway.isOnline(r.device.controllerId) : false,
  }));
}

/** Push deviceId <-> channel mapping to the board. */
export async function sendConfig(ctx: AppContext, controllerId: string, keyId?: string): Promise<void> {
  const key =
    keyId ??
    (
      await ctx.db
        .select({ keyId: controllers.keyId })
        .from(controllers)
        .where(eq(controllers.id, controllerId))
    )[0]?.keyId;
  if (!key) return;
  const list = await ctx.db.select().from(devices).where(eq(devices.controllerId, controllerId));
  ctx.services.gateway.send(controllerId, {
    deviceId: key,
    action: controllerActions.config,
    value: {
      channels: list
        .filter((d) => d.channel !== null)
        .map((d) => ({
          channel: d.channel!,
          deviceId: d.id,
          type: d.type,
          powerOnBehavior: d.config.powerOnBehavior ?? 'last',
        })),
    },
  });
}

/** Board connected: record metadata, create devices for new channels, push config, restore states. */
export async function onControllerConnected(ctx: AppContext, auth: ControllerAuth, meta: HandshakeMeta) {
  const now = new Date();
  await ctx.db
    .update(controllers)
    .set({
      online: true,
      lastSeenAt: now,
      model: meta.model,
      firmwareVersion: meta.version,
      mac: meta.mac,
      ip: meta.ip,
    })
    .where(eq(controllers.id, auth.controllerId));

  const existing = await ctx.db.select().from(devices).where(eq(devices.controllerId, auth.controllerId));
  const byChannel = new Map(existing.map((d) => [d.channel, d]));
  const created: string[] = [];
  for (const { channel, type } of meta.channels) {
    const template = await resolveTemplate(ctx, auth.homeId, type);
    if (!template) {
      ctx.log.warn({ controllerId: auth.controllerId, type }, 'board declared unknown device type');
      continue;
    }
    const current = byChannel.get(channel);
    if (current) {
      if (current.type !== type) {
        await ctx.db
          .update(devices)
          .set({ type, capabilities: template.capabilities, icon: template.icon })
          .where(eq(devices.id, current.id));
      }
      continue;
    }
    const [d] = await ctx.db
      .insert(devices)
      .values({
        homeId: auth.homeId,
        controllerId: auth.controllerId,
        channel,
        type,
        name: `${template.name} ${channel}`,
        icon: template.icon,
        capabilities: template.capabilities,
        config: { ratedWatts: template.defaultWatts ?? 0, powerOnBehavior: 'last', modes: template.modes },
      })
      .returning({ id: devices.id });
    await ctx.db.insert(deviceState).values({ deviceId: d!.id, state: {} });
    created.push(d!.id);
  }
  await sendConfig(ctx, auth.controllerId, auth.keyId);

  const all = await ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.controllerId, auth.controllerId));
  await ctx.db.insert(deviceEvents).values({
    homeId: auth.homeId,
    controllerId: auth.controllerId,
    kind: 'online',
    source: 'system',
    value: { version: meta.version, created: created.length },
  });
  ctx.bus.publishHome(auth.homeId, {
    type: 'device.online',
    controllerId: auth.controllerId,
    online: true,
    deviceIds: all.map((d) => d.id),
    at: now.toISOString(),
  });
  for (const id of created) ctx.bus.publishHome(auth.homeId, { type: 'device.changed', deviceId: id });

  if (meta.restoreStates) await restoreStates(ctx, auth.controllerId);
  for (const fn of connectedHandlers) await fn(ctx, auth, meta);
}

/** Re-send the last known state to channels configured to take their power-on state from the cloud. */
async function restoreStates(ctx: AppContext, controllerId: string) {
  const rows = await ctx.db
    .select({ device: devices, state: deviceState.state })
    .from(devices)
    .innerJoin(deviceState, eq(deviceState.deviceId, devices.id))
    .where(eq(devices.controllerId, controllerId));
  for (const { device, state } of rows) {
    if (device.config.powerOnBehavior !== 'cloud' || !state.powerState) continue;
    const steps: [string, Record<string, unknown>][] = [['setPowerState', { state: state.powerState }]];
    if (typeof state.powerLevel === 'number') steps.push(['setPowerLevel', { powerLevel: state.powerLevel }]);
    if (typeof state.brightness === 'number') steps.push(['setBrightness', { brightness: state.brightness }]);
    for (const [action, value] of steps) {
      await executeAction(ctx, device, action, value, { source: 'restore' }).catch((err) =>
        ctx.log.warn({ err, deviceId: device.id }, 'state restore failed'),
      );
    }
  }
}

/** Extra hooks run after a board connects (e.g. OTA offers). */
export const connectedHandlers: ((
  ctx: AppContext,
  auth: ControllerAuth,
  meta: HandshakeMeta,
) => Promise<void>)[] = [];
/** Handlers for controller-level events by action (e.g. otaStatus). */
export const controllerEventHandlers = new Map<
  string,
  (ctx: AppContext, auth: ControllerAuth, p: Payload) => Promise<void>
>();

export async function onControllerOffline(ctx: AppContext, auth: ControllerAuth) {
  const now = new Date();
  await ctx.db
    .update(controllers)
    .set({ online: false, lastSeenAt: now })
    .where(eq(controllers.id, auth.controllerId));
  const list = await ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(eq(devices.controllerId, auth.controllerId));
  await ctx.db
    .insert(deviceEvents)
    .values({ homeId: auth.homeId, controllerId: auth.controllerId, kind: 'offline', source: 'system' });
  ctx.bus.publishHome(auth.homeId, {
    type: 'device.online',
    controllerId: auth.controllerId,
    online: false,
    deviceIds: list.map((d) => d.id),
    at: now.toISOString(),
  });
  ctx.services.notifications.scheduleOfflineAlert(auth.controllerId, auth.homeId);
}

// ── Device events (physical switches, sensors) ──────────────────────────────
const buckets = new Map<string, { tokens: number; at: number }>();
const lastTelemetry = new Map<string, number>();

function allowEvent(deviceId: string, telemetry: boolean): boolean {
  const now = Date.now();
  if (telemetry) {
    const last = lastTelemetry.get(deviceId) ?? 0;
    if (now - last < TELEMETRY_MIN_INTERVAL_S * 1000) return false;
    lastTelemetry.set(deviceId, now);
    return true;
  }
  const b = buckets.get(deviceId) ?? { tokens: EVENT_BURST, at: now };
  b.tokens = Math.min(EVENT_BURST, b.tokens + ((now - b.at) / 1000) * EVENT_REFILL_PER_S);
  b.at = now;
  buckets.set(deviceId, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export async function onDeviceEvent(ctx: AppContext, auth: ControllerAuth, p: Payload) {
  if (p.deviceId === auth.keyId) {
    const handler = controllerEventHandlers.get(p.action);
    if (handler) await handler(ctx, auth, p);
    return;
  }
  const [device] = await ctx.db
    .select()
    .from(devices)
    .where(and(eq(devices.id, p.deviceId), eq(devices.controllerId, auth.controllerId)))
    .limit(1);
  if (!device) return; // stale config on the board; it will get a fresh one on reconnect
  const def = findEvent(device.capabilities, p.action);
  if (!def) return ctx.log.warn({ deviceId: device.id, action: p.action }, 'unsupported event');
  if (!allowEvent(`${device.id}:${def.readings ? 't' : 's'}`, !!def.readings)) return;
  const parsed = def.value.safeParse(p.value);
  if (!parsed.success) return ctx.log.warn({ deviceId: device.id, action: p.action }, 'invalid event value');

  const physical = p.cause?.type === 'PHYSICAL_INTERACTION' || p.clientId === 'physical';
  await applyState(ctx, device, def.state(parsed.data), {
    source: physical ? 'physical' : 'system',
    kind: 'event',
    action: p.action,
    value: parsed.data,
  });

  if (def.readings) {
    const now = new Date();
    const rows = Object.entries(def.readings(parsed.data))
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([m, v]) => ({
        deviceId: device.id,
        metric: metrics[m as keyof typeof metrics],
        ts: now,
        value: v as number,
      }));
    if (rows.length) await ctx.db.insert(sensorReadings).values(rows);
  }
  const message = def.notify?.(parsed.data);
  if (message) await ctx.services.notifications.deviceAlert(device, p.action, message);
}

// ── Commands ────────────────────────────────────────────────────────────────
export interface ActionOptions {
  source: Source;
  actorUserId?: string | null;
  depth?: number;
}

/** Validate, send to the board, wait for its answer, persist the resulting state. */
export async function executeAction(
  ctx: AppContext,
  device: Device,
  action: string,
  value: Record<string, unknown>,
  opts: ActionOptions,
): Promise<Record<string, unknown>> {
  const def = findAction(device.capabilities, action);
  if (!def) throw badRequest(`"${device.name}" does not support ${action}`, 'UNSUPPORTED_ACTION');
  const parsed = def.value.safeParse(value);
  if (!parsed.success)
    throw badRequest('Invalid value for this action', 'INVALID_VALUE', parsed.error.issues);
  if (!device.controllerId || !ctx.services.gateway.isOnline(device.controllerId)) {
    throw new AppError(409, 'DEVICE_OFFLINE', `${device.name} is offline`);
  }

  await ctx.db.insert(deviceEvents).values({
    homeId: device.homeId,
    deviceId: device.id,
    controllerId: device.controllerId,
    kind: 'command',
    action,
    value: parsed.data,
    source: opts.source,
    actorUserId: opts.actorUserId ?? null,
  });

  const response = await ctx.services.gateway.request(device.controllerId, {
    deviceId: device.id,
    action,
    value: parsed.data,
    clientId: opts.source,
  });
  if (response.success === false) {
    await ctx.db.insert(deviceEvents).values({
      homeId: device.homeId,
      deviceId: device.id,
      controllerId: device.controllerId,
      kind: 'response',
      action,
      source: opts.source,
      success: false,
      message: response.message?.slice(0, 200) ?? null,
    });
    throw new AppError(422, 'DEVICE_REJECTED', response.message || `${device.name} refused the command`);
  }
  // Devices answer with the resulting absolute value (e.g. adjustBrightness -> {brightness: 60}).
  let patch = def.state(response.value);
  if (!Object.keys(patch).length) patch = def.state(parsed.data);
  return applyState(ctx, device, patch, {
    source: opts.source,
    kind: 'response',
    action,
    value: response.value,
    actorUserId: opts.actorUserId,
    depth: opts.depth,
  });
}

export async function loadDevices(ctx: AppContext, ids: string[]) {
  return ids.length ? ctx.db.select().from(devices).where(inArray(devices.id, ids)) : [];
}
