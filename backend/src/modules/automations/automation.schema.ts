import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const days = z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(); // 0 = Sunday
const compareOp = z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'changed']);
const scalar = z.union([z.string().max(64), z.number(), z.boolean()]);

export const triggerSchema = z.discriminatedUnion('kind', [
  /** Repeating schedule (5-field cron in the home's time zone). */
  z.object({ kind: z.literal('time'), cron: z.string().min(9).max(100) }),
  /** Sunrise/sunset with offset. Needs home latitude/longitude. */
  z.object({
    kind: z.literal('sun'),
    event: z.enum(['sunrise', 'sunset']),
    offsetMin: z.number().int().min(-180).max(180).default(0),
    days,
  }),
  /** One-shot timer. Disables itself after running. */
  z.object({ kind: z.literal('once'), at: z.iso.datetime({ offset: true }) }),
  /** Daily window: `actions` at start, `endActions` at end (the device-page "Schedule" card). */
  z.object({ kind: z.literal('window'), start: hhmm, end: hhmm, days }),
  /** Device state / sensor reading crosses a condition (fires on the false -> true transition). */
  z.object({
    kind: z.literal('device'),
    deviceId: z.uuid(),
    key: z.string().min(1).max(40),
    op: compareOp,
    value: scalar.optional(),
    /** For numeric thresholds: must move back past value -/+ hysteresis before re-arming. */
    hysteresis: z.number().min(0).max(1000).default(0),
  }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const conditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeWindow'), from: hhmm, to: hhmm }),
  z.object({ kind: z.literal('days'), days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }),
  z.object({
    kind: z.literal('device'),
    deviceId: z.uuid(),
    key: z.string().min(1).max(40),
    op: compareOp.exclude(['changed']),
    value: scalar,
  }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('device'),
    deviceId: z.uuid(),
    action: z.string().min(1).max(64),
    value: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({ kind: z.literal('scene'), sceneId: z.uuid() }),
  z.object({
    kind: z.literal('notify'),
    title: z.string().min(1).max(100),
    body: z.string().max(300).default(''),
  }),
  z.object({ kind: z.literal('delay'), seconds: z.number().int().min(1).max(3600) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const automationBody = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1).max(20),
  endActions: z.array(actionSchema).max(20).optional(),
  cooldownS: z.number().int().min(0).max(86_400).default(5),
});
export type AutomationInput = z.infer<typeof automationBody>;

export function compare(actual: unknown, op: string, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    default:
      return false;
  }
}
