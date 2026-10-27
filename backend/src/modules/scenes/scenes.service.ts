import { inArray } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { devices, type scenes } from '../../db/schema';
import { executeAction } from '../devices/devices.service';
import type { Source } from '../devices/state.service';

type Scene = typeof scenes.$inferSelect;

/** Run every step of a scene in parallel; one offline device doesn't stop the others. */
export async function runScene(
  ctx: AppContext,
  scene: Scene,
  opts: { source: Source; actorUserId?: string | null; depth?: number },
) {
  const ids = [...new Set(scene.actions.map((a) => a.deviceId))];
  const list = ids.length ? await ctx.db.select().from(devices).where(inArray(devices.id, ids)) : [];
  const byId = new Map(list.filter((d) => d.homeId === scene.homeId).map((d) => [d.id, d]));
  const results = await Promise.allSettled(
    scene.actions.map(async (step) => {
      const device = byId.get(step.deviceId);
      if (!device) throw new Error('device no longer exists');
      await executeAction(ctx, device, step.action, step.value, { ...opts, source: opts.source });
    }),
  );
  const steps = results.map((r, i) => ({
    deviceId: scene.actions[i]!.deviceId,
    ok: r.status === 'fulfilled',
    error: r.status === 'rejected' ? (r.reason as Error).message : undefined,
  }));
  return { steps, failed: steps.filter((s) => !s.ok).length };
}
