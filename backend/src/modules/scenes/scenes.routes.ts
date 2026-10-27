import { findAction } from '@voltix/protocol';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { devices, scenes } from '../../db/schema';
import { requireHomeRole, requireUser } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { runScene } from './scenes.service';

const stepSchema = z.object({
  deviceId: z.uuid(),
  action: z.string().min(1).max(64),
  value: z.record(z.string(), z.unknown()).default({}),
});
const sceneBody = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(40).optional(),
  actions: z.array(stepSchema).min(1).max(50),
});

/** Ensure each step targets a device in this home that supports the action with a valid value. */
export async function validateSteps(ctx: AppContext, homeId: string, steps: z.infer<typeof stepSchema>[]) {
  const ids = [...new Set(steps.map((s) => s.deviceId))];
  const list = ids.length
    ? await ctx.db
        .select()
        .from(devices)
        .where(and(inArray(devices.id, ids), eq(devices.homeId, homeId)))
    : [];
  const byId = new Map(list.map((d) => [d.id, d]));
  for (const s of steps) {
    const d = byId.get(s.deviceId);
    if (!d) throw badRequest('A selected device does not belong to this home', 'INVALID_DEVICE');
    const def = findAction(d.capabilities, s.action);
    if (!def) throw badRequest(`"${d.name}" does not support ${s.action}`, 'UNSUPPORTED_ACTION');
    if (!def.value.safeParse(s.value).success)
      throw badRequest(`Invalid value for "${d.name}"`, 'INVALID_VALUE');
  }
}

export const scenesRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const load = async (id: string) => {
    const [s] = await ctx.db.select().from(scenes).where(eq(scenes.id, id)).limit(1);
    if (!s) throw notFound('Scene');
    return s;
  };

  app.get(
    '/homes/:homeId/scenes',
    {
      config: { apiKeyScope: 'homes:read' },
      schema: { tags: ['scenes'], params: z.object({ homeId: z.uuid() }) },
    },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId);
      return {
        scenes: await ctx.db
          .select()
          .from(scenes)
          .where(eq(scenes.homeId, req.params.homeId))
          .orderBy(asc(scenes.createdAt)),
      };
    },
  );

  app.post(
    '/homes/:homeId/scenes',
    { schema: { tags: ['scenes'], params: z.object({ homeId: z.uuid() }), body: sceneBody } },
    async (req, reply) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const [n] = await ctx.db
        .select({ n: count() })
        .from(scenes)
        .where(eq(scenes.homeId, req.params.homeId));
      if ((n?.n ?? 0) >= 100) throw badRequest('A home can have at most 100 scenes', 'SCENE_LIMIT');
      await validateSteps(ctx, req.params.homeId, req.body.actions);
      const [scene] = await ctx.db
        .insert(scenes)
        .values({ homeId: req.params.homeId, createdBy: requireUser(req), ...req.body })
        .returning();
      return reply.code(201).send({ scene });
    },
  );

  app.patch(
    '/scenes/:sceneId',
    { schema: { tags: ['scenes'], params: z.object({ sceneId: z.uuid() }), body: sceneBody.partial() } },
    async (req) => {
      const scene = await load(req.params.sceneId);
      await requireHomeRole(ctx, req, scene.homeId, 'admin');
      if (req.body.actions) await validateSteps(ctx, scene.homeId, req.body.actions);
      const [updated] = await ctx.db
        .update(scenes)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(scenes.id, scene.id))
        .returning();
      return { scene: updated };
    },
  );

  app.delete(
    '/scenes/:sceneId',
    { schema: { tags: ['scenes'], params: z.object({ sceneId: z.uuid() }) } },
    async (req, reply) => {
      const scene = await load(req.params.sceneId);
      await requireHomeRole(ctx, req, scene.homeId, 'admin');
      await ctx.db.delete(scenes).where(eq(scenes.id, scene.id));
      return reply.code(204).send();
    },
  );

  app.post(
    '/scenes/:sceneId/run',
    {
      config: { apiKeyScope: 'scenes:run', rateLimit: { max: 20, timeWindow: '10 seconds' } },
      schema: { tags: ['scenes'], params: z.object({ sceneId: z.uuid() }) },
    },
    async (req) => {
      const scene = await load(req.params.sceneId);
      await requireHomeRole(ctx, req, scene.homeId);
      return runScene(ctx, scene, { source: 'scene', actorUserId: req.auth?.userId });
    },
  );
};
