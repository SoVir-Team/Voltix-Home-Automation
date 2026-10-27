import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { automationRuns, automations, devices, homes } from '../../db/schema';
import { requireHomeRole, requireUser } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { validateSteps } from '../scenes/scenes.routes';
import { type Action, type AutomationInput, automationBody } from './automation.schema';

const params = z.object({ automationId: z.uuid() });

export const automationsRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const engine = () => ctx.services.automations;
  const load = async (id: string) => {
    const [a] = await ctx.db.select().from(automations).where(eq(automations.id, id)).limit(1);
    if (!a) throw notFound('Automation');
    return a;
  };

  /** Validate cross-references (devices in this home, supported actions, geo for sun triggers). */
  const validate = async (homeId: string, body: Partial<AutomationInput>) => {
    const deviceSteps = [...(body.actions ?? []), ...(body.endActions ?? [])].filter(
      (s): s is Extract<Action, { kind: 'device' }> => s.kind === 'device',
    );
    await validateSteps(ctx, homeId, deviceSteps);
    if (body.trigger?.kind === 'device') {
      const [d] = await ctx.db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, body.trigger.deviceId), eq(devices.homeId, homeId)));
      if (!d) throw badRequest('Trigger device does not belong to this home', 'INVALID_DEVICE');
    }
    if (body.trigger?.kind === 'sun') {
      const [h] = await ctx.db.select({ lat: homes.latitude }).from(homes).where(eq(homes.id, homeId));
      if (h?.lat == null)
        throw badRequest('Set your home location to use sunrise/sunset schedules', 'NO_LOCATION');
    }
    if (body.trigger?.kind === 'once' && new Date(body.trigger.at) <= new Date()) {
      throw badRequest('Pick a time in the future', 'TIME_IN_PAST');
    }
  };

  app.get(
    '/homes/:homeId/automations',
    { schema: { tags: ['automations'], params: z.object({ homeId: z.uuid() }) } },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId);
      return {
        automations: await ctx.db
          .select()
          .from(automations)
          .where(eq(automations.homeId, req.params.homeId))
          .orderBy(asc(automations.createdAt)),
      };
    },
  );

  app.post(
    '/homes/:homeId/automations',
    { schema: { tags: ['automations'], params: z.object({ homeId: z.uuid() }), body: automationBody } },
    async (req, reply) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const [n] = await ctx.db
        .select({ n: count() })
        .from(automations)
        .where(eq(automations.homeId, req.params.homeId));
      if ((n?.n ?? 0) >= 200) throw badRequest('A home can have at most 200 automations', 'AUTOMATION_LIMIT');
      await validate(req.params.homeId, req.body);
      const [a] = await ctx.db
        .insert(automations)
        .values({
          homeId: req.params.homeId,
          createdBy: requireUser(req),
          ...req.body,
          endActions: req.body.endActions ?? [],
        })
        .returning();
      await engine().schedule(a!);
      await engine().reloadIndex();
      const [fresh] = await ctx.db.select().from(automations).where(eq(automations.id, a!.id));
      return reply.code(201).send({ automation: fresh });
    },
  );

  app.patch(
    '/automations/:automationId',
    { schema: { tags: ['automations'], params, body: automationBody.partial() } },
    async (req) => {
      const a = await load(req.params.automationId);
      await requireHomeRole(ctx, req, a.homeId, 'admin');
      await validate(a.homeId, req.body);
      const [updated] = await ctx.db
        .update(automations)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(automations.id, a.id))
        .returning();
      await engine().schedule(updated!);
      await engine().reloadIndex();
      const [fresh] = await ctx.db.select().from(automations).where(eq(automations.id, a.id));
      return { automation: fresh };
    },
  );

  app.delete(
    '/automations/:automationId',
    { schema: { tags: ['automations'], params } },
    async (req, reply) => {
      const a = await load(req.params.automationId);
      await requireHomeRole(ctx, req, a.homeId, 'admin');
      await ctx.db.delete(automations).where(eq(automations.id, a.id));
      await engine().reloadIndex();
      return reply.code(204).send();
    },
  );

  app.post('/automations/:automationId/run', { schema: { tags: ['automations'], params } }, async (req) => {
    const a = await load(req.params.automationId);
    await requireHomeRole(ctx, req, a.homeId, 'admin');
    const status = await engine().run(a, a.actions, { manual: true }, 0, 'automation');
    return { status };
  });

  app.get('/automations/:automationId/runs', { schema: { tags: ['automations'], params } }, async (req) => {
    const a = await load(req.params.automationId);
    await requireHomeRole(ctx, req, a.homeId);
    return {
      runs: await ctx.db
        .select()
        .from(automationRuns)
        .where(eq(automationRuns.automationId, a.id))
        .orderBy(desc(automationRuns.at))
        .limit(50),
    };
  });
};
