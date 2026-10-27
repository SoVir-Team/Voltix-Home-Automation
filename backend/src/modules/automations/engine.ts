import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { automationRuns, automations, deviceState, devices, homes, scenes } from '../../db/schema';
import { executeAction } from '../devices/devices.service';
import type { Device } from '../devices/state.service';
import { localDate } from '../energy/energy';
import { runScene } from '../scenes/scenes.service';
import {
  type Action,
  type Condition,
  compare,
  conditionSchema,
  actionSchema as stepSchema,
  type Trigger,
  triggerSchema,
} from './automation.schema';
import { type HomeGeo, inTimeWindow, nextRun, weekday } from './schedule';

type Automation = typeof automations.$inferSelect;

const TICK_MS = 5_000;
/** Scheduled runs missed by more than this (e.g. server was down) are skipped, not replayed. */
const MISFIRE_MS = 5 * 60_000;
/** Max automation -> device -> automation chain length. */
export const MAX_DEPTH = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs schedules (DB ticker) and device-triggered rules (in-memory index). */
export class AutomationEngine {
  private timer?: NodeJS.Timeout;
  private ticking = false;
  /** deviceId -> automations triggered by it. */
  private byDevice = new Map<string, Automation[]>();
  private lastFired = new Map<string, number>();
  /** Threshold triggers re-arm only after leaving the hysteresis band. */
  private armed = new Map<string, boolean>();

  constructor(private readonly ctx: AppContext) {}

  async start(): Promise<void> {
    await this.reloadIndex();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Rebuild the device-trigger index (after any automation change). Cheap at this scale. */
  async reloadIndex(): Promise<void> {
    const rows = await this.ctx.db
      .select()
      .from(automations)
      .where(and(eq(automations.enabled, true), sql`${automations.trigger}->>'kind' = 'device'`));
    const index = new Map<string, Automation[]>();
    for (const a of rows) {
      const id = (a.trigger as { deviceId: string }).deviceId;
      index.set(id, [...(index.get(id) ?? []), a]);
    }
    this.byDevice = index;
  }

  /** Compute and store next_run_at for a scheduled automation. */
  async schedule(
    a: Pick<Automation, 'id' | 'homeId' | 'trigger' | 'enabled'>,
    now = new Date(),
  ): Promise<void> {
    const trigger = triggerSchema.parse(a.trigger);
    const home = await this.homeGeo(a.homeId);
    const next = a.enabled && home ? nextRun(trigger, home, now) : null;
    await this.ctx.db
      .update(automations)
      .set({ nextRunAt: next?.at ?? null, nextEdge: next?.edge ?? null })
      .where(eq(automations.id, a.id));
  }

  private async homeGeo(homeId: string): Promise<HomeGeo | undefined> {
    const [h] = await this.ctx.db
      .select({ timezone: homes.timezone, latitude: homes.latitude, longitude: homes.longitude })
      .from(homes)
      .where(eq(homes.id, homeId));
    return h;
  }

  /** Claim due automations (SKIP LOCKED: safe with several processes), reschedule, then run. */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const claimed = await this.ctx.db.transaction(async (tx) => {
        const due = await tx
          .select({ a: automations, tz: homes.timezone, lat: homes.latitude, lon: homes.longitude })
          .from(automations)
          .innerJoin(homes, eq(homes.id, automations.homeId))
          .where(
            and(
              eq(automations.enabled, true),
              isNotNull(automations.nextRunAt),
              lte(automations.nextRunAt, now),
            ),
          )
          .orderBy(automations.nextRunAt)
          .limit(50)
          .for('update', { of: automations, skipLocked: true });
        for (const { a, tz, lat, lon } of due) {
          const trigger = triggerSchema.parse(a.trigger);
          const next = nextRun(trigger, { timezone: tz, latitude: lat, longitude: lon }, now);
          await tx
            .update(automations)
            .set({
              nextRunAt: next?.at ?? null,
              nextEdge: next?.edge ?? null,
              ...(trigger.kind === 'once' && { enabled: false }),
            })
            .where(eq(automations.id, a.id));
        }
        return due.map((d) => d.a);
      });
      for (const a of claimed) {
        const late = now.getTime() - a.nextRunAt!.getTime() > MISFIRE_MS;
        if (late) {
          this.ctx.log.info({ automationId: a.id }, 'skipping missed schedule');
          continue;
        }
        const steps = a.nextEdge === 'end' ? a.endActions : a.actions;
        this.runInBackground(
          a,
          steps,
          { scheduled: a.nextRunAt!.toISOString(), edge: a.nextEdge },
          0,
          'schedule',
        );
      }
    } catch (err) {
      this.ctx.log.error({ err }, 'automation tick failed');
    } finally {
      this.ticking = false;
    }
  }

  /** Called by the state service after every device state change. */
  onDeviceState(
    device: Device,
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    depth: number,
  ): void {
    const list = this.byDevice.get(device.id);
    if (!list) return;
    for (const a of list) {
      const t = a.trigger as Extract<Trigger, { kind: 'device' }>;
      if (!this.deviceTriggerFires(a.id, t, prev[t.key], next[t.key])) continue;
      if (depth >= MAX_DEPTH) {
        this.ctx.log.warn({ automationId: a.id, depth }, 'automation loop guard stopped a chain');
        continue;
      }
      const last = this.lastFired.get(a.id) ?? 0;
      if (Date.now() - last < a.cooldownS * 1000) continue;
      this.lastFired.set(a.id, Date.now());
      this.runInBackground(
        a,
        a.actions,
        { deviceId: device.id, key: t.key, value: next[t.key] },
        depth + 1,
        'automation',
      );
    }
  }

  /** Nobody awaits these runs; an unhandled rejection would stop the whole process. */
  private runInBackground(...args: Parameters<AutomationEngine['run']>): void {
    this.run(...args).catch((err) =>
      this.ctx.log.error({ err, automationId: args[0].id }, 'automation run failed'),
    );
  }

  private deviceTriggerFires(
    id: string,
    t: Extract<Trigger, { kind: 'device' }>,
    before: unknown,
    after: unknown,
  ): boolean {
    if (t.op === 'changed') return before !== after && after !== undefined;
    const matches = compare(after, t.op, t.value);
    const numeric = typeof after === 'number' && typeof t.value === 'number' && t.hysteresis > 0;
    if (numeric) {
      const v = t.value as number;
      const n = after as number;
      const isArmed = this.armed.get(id) ?? true;
      // re-arm once the reading has moved back past the hysteresis band
      const backOff = t.op.startsWith('g') ? n < v - t.hysteresis : n > v + t.hysteresis;
      if (!isArmed && backOff) this.armed.set(id, true);
      if (matches && (this.armed.get(id) ?? true)) {
        this.armed.set(id, false);
        return true;
      }
      return false;
    }
    return matches && !compare(before, t.op, t.value);
  }

  private async conditionsHold(a: Automation, now: Date): Promise<boolean> {
    const conditions = conditionSchema.array().parse(a.conditions ?? []) as Condition[];
    if (!conditions.length) return true;
    const geo = await this.homeGeo(a.homeId);
    const tz = geo?.timezone ?? 'UTC';
    for (const c of conditions) {
      if (c.kind === 'timeWindow' && !inTimeWindow(now, tz, c.from, c.to)) return false;
      if (c.kind === 'days' && !c.days.includes(weekday(localDate(now, tz)))) return false;
      if (c.kind === 'device') {
        const [s] = await this.ctx.db
          .select({ state: deviceState.state })
          .from(deviceState)
          .innerJoin(devices, eq(devices.id, deviceState.deviceId))
          .where(and(eq(deviceState.deviceId, c.deviceId), eq(devices.homeId, a.homeId)));
        if (!s || !compare(s.state[c.key], c.op, c.value)) return false;
      }
    }
    return true;
  }

  /** Execute steps sequentially; record the outcome. */
  async run(
    a: Automation,
    rawSteps: unknown[],
    triggerInfo: Record<string, unknown>,
    depth: number,
    source: 'schedule' | 'automation',
  ): Promise<string> {
    const now = new Date();
    if (!(await this.conditionsHold(a, now))) {
      await this.ctx.db
        .insert(automationRuns)
        .values({ automationId: a.id, triggerInfo, status: 'skipped', results: [] });
      return 'skipped';
    }
    const steps = stepSchema.array().parse(rawSteps) as Action[];
    const results: unknown[] = [];
    let failed = 0;
    for (const step of steps) {
      try {
        if (step.kind === 'delay') {
          // shortcut: in-memory delay, lost on restart; fine for <= 1 h delays
          await sleep(step.seconds * 1000);
          results.push({ kind: 'delay', ok: true });
        } else if (step.kind === 'device') {
          const [device] = await this.ctx.db
            .select()
            .from(devices)
            .where(and(eq(devices.id, step.deviceId), eq(devices.homeId, a.homeId)));
          if (!device) throw new Error('device no longer exists');
          await executeAction(this.ctx, device, step.action, step.value, { source, depth });
          results.push({ kind: 'device', deviceId: step.deviceId, ok: true });
        } else if (step.kind === 'scene') {
          const [scene] = await this.ctx.db
            .select()
            .from(scenes)
            .where(and(eq(scenes.id, step.sceneId), eq(scenes.homeId, a.homeId)));
          if (!scene) throw new Error('scene no longer exists');
          const r = await runScene(this.ctx, scene, { source, depth });
          results.push({ kind: 'scene', sceneId: scene.id, ok: r.failed === 0 });
          if (r.failed) failed++;
        } else {
          await this.ctx.services.notifications.notify({
            type: 'automation',
            homeId: a.homeId,
            title: step.title,
            body: step.body,
            data: { automationId: a.id },
          });
          results.push({ kind: 'notify', ok: true });
        }
      } catch (err) {
        failed++;
        results.push({ kind: step.kind, ok: false, error: (err as Error).message });
      }
    }
    const status = failed === 0 ? 'ok' : failed === steps.length ? 'failed' : 'partial';
    await this.ctx.db.insert(automationRuns).values({ automationId: a.id, triggerInfo, status, results });
    await this.ctx.db
      .update(automations)
      .set({ lastRunAt: now, lastStatus: status })
      .where(eq(automations.id, a.id));
    this.ctx.bus.publishHome(a.homeId, {
      type: 'automation.run',
      automationId: a.id,
      status,
      at: now.toISOString(),
    });
    return status;
  }
}
