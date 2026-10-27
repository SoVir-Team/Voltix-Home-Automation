import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { deviceEvents, deviceState, type devices, homes } from '../../db/schema';
import { accrue, levelFactor } from '../energy/energy';

export type Device = typeof devices.$inferSelect;
export type Source = (typeof deviceEvents.$inferInsert)['source'];

export interface ApplyOptions {
  source: Source;
  kind: 'response' | 'event';
  action: string;
  value: Record<string, unknown>;
  actorUserId?: string | null;
  /** Automation chain depth (loop guard). */
  depth?: number;
}

const isOn = (s: Record<string, unknown>) => s.powerState === 'On';

/**
 * The single path for persisting a device state change: merges state, accrues energy, logs activity,
 * pushes the change to browsers and lets automations react.
 */
export async function applyState(
  ctx: AppContext,
  device: Device,
  patch: Record<string, unknown>,
  opts: ApplyOptions,
): Promise<Record<string, unknown>> {
  const now = new Date();
  const next = await ctx.db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(deviceState)
      .where(eq(deviceState.deviceId, device.id))
      .for('update');
    const prev = cur?.state ?? {};
    const merged = { ...prev, ...patch };
    let since = cur?.powerOnSince ?? null;

    const watts = device.config.ratedWatts ?? 0;
    const levelChanged = levelFactor(prev) !== levelFactor(merged);
    if (isOn(prev) && since && (!isOn(merged) || levelChanged)) {
      const [home] = await tx.select({ tz: homes.timezone }).from(homes).where(eq(homes.id, device.homeId));
      await accrue(tx, device.id, home?.tz ?? 'UTC', since, now, watts, levelFactor(prev));
      since = isOn(merged) ? now : null;
    } else if (!isOn(prev) && isOn(merged)) {
      since = now;
    }

    await tx
      .insert(deviceState)
      .values({ deviceId: device.id, state: merged, powerOnSince: since, updatedAt: now })
      .onConflictDoUpdate({
        target: deviceState.deviceId,
        set: { state: merged, powerOnSince: since, updatedAt: now },
      });
    await tx.insert(deviceEvents).values({
      homeId: device.homeId,
      deviceId: device.id,
      controllerId: device.controllerId,
      kind: opts.kind,
      action: opts.action,
      value: opts.value,
      source: opts.source,
      actorUserId: opts.actorUserId ?? null,
      success: true,
      at: now,
    });
    return { prev, merged };
  });

  ctx.bus.publishHome(device.homeId, {
    type: 'device.state',
    deviceId: device.id,
    state: next.merged,
    source: opts.source,
    at: now.toISOString(),
  });
  ctx.services.automations.onDeviceState(device, next.prev, next.merged, opts.depth ?? 0);
  return next.merged;
}
