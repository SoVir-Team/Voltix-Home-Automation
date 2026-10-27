import { randomBytes } from 'node:crypto';
import { controllerActions } from '@voltix/protocol/node';
import { asc, count, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { controllers, devices } from '../../db/schema';
import { requireHomeRole } from '../../lib/access';
import { encryptSecret, randomToken } from '../../lib/crypto';
import { AppError, badRequest, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';

const params = z.object({ controllerId: z.uuid() });

const view = (c: typeof controllers.$inferSelect, live: boolean) => ({
  id: c.id,
  homeId: c.homeId,
  name: c.name,
  keyId: c.keyId,
  model: c.model,
  mac: c.mac,
  firmwareVersion: c.firmwareVersion,
  ip: c.ip,
  lanIp: c.lanIp,
  localName: c.localName,
  online: live,
  lastSeenAt: c.lastSeenAt,
  createdAt: c.createdAt,
});

/** Controllers are the physical boards (one ESP32 = one connection, many devices on channels). */
export const controllersRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const newCredentials = () => {
    const keyId = `vxc_${randomBytes(10).toString('hex')}`;
    const secret = randomToken(32);
    return { keyId, secret, secretEnc: encryptSecret(secret, ctx.encKey) };
  };
  const load = async (id: string) => {
    const [c] = await ctx.db.select().from(controllers).where(eq(controllers.id, id)).limit(1);
    if (!c) throw notFound('Board');
    return c;
  };

  app.get(
    '/homes/:homeId/controllers',
    { schema: { tags: ['controllers'], params: z.object({ homeId: z.uuid() }) } },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const list = await ctx.db
        .select({
          c: controllers,
          deviceCount: count(devices.id),
        })
        .from(controllers)
        .leftJoin(devices, eq(devices.controllerId, controllers.id))
        .where(eq(controllers.homeId, req.params.homeId))
        .groupBy(controllers.id)
        .orderBy(asc(controllers.createdAt));
      return {
        controllers: list.map((r) => ({
          ...view(r.c, ctx.services.gateway.isOnline(r.c.id)),
          deviceCount: r.deviceCount,
        })),
      };
    },
  );

  app.post(
    '/homes/:homeId/controllers',
    {
      schema: {
        tags: ['controllers'],
        params: z.object({ homeId: z.uuid() }),
        body: z.object({ name: z.string().trim().min(1).max(60) }),
      },
    },
    async (req, reply) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const [n] = await ctx.db
        .select({ n: count() })
        .from(controllers)
        .where(eq(controllers.homeId, req.params.homeId));
      if ((n?.n ?? 0) >= 50) throw badRequest('A home can have at most 50 boards', 'CONTROLLER_LIMIT');
      const { keyId, secret, secretEnc } = newCredentials();
      const [c] = await ctx.db
        .insert(controllers)
        .values({ homeId: req.params.homeId, name: req.body.name, keyId, secretEnc })
        .returning();
      await audit(ctx, req, 'controller.create', { type: 'controller', id: c!.id });
      // The secret is shown exactly once; only its encrypted form is stored.
      return reply.code(201).send({ controller: view(c!, false), credentials: { keyId, secret } });
    },
  );

  app.get('/controllers/:controllerId', { schema: { tags: ['controllers'], params } }, async (req) => {
    const c = await load(req.params.controllerId);
    await requireHomeRole(ctx, req, c.homeId, 'admin');
    return { controller: view(c, ctx.services.gateway.isOnline(c.id)) };
  });

  app.patch(
    '/controllers/:controllerId',
    { schema: { tags: ['controllers'], params, body: z.object({ name: z.string().trim().min(1).max(60) }) } },
    async (req) => {
      const c = await load(req.params.controllerId);
      await requireHomeRole(ctx, req, c.homeId, 'admin');
      const [u] = await ctx.db
        .update(controllers)
        .set({ name: req.body.name })
        .where(eq(controllers.id, c.id))
        .returning();
      return { controller: view(u!, ctx.services.gateway.isOnline(c.id)) };
    },
  );

  app.post(
    '/controllers/:controllerId/regenerate-secret',
    { schema: { tags: ['controllers'], params } },
    async (req) => {
      const c = await load(req.params.controllerId);
      await requireHomeRole(ctx, req, c.homeId, 'admin');
      const secret = randomToken(32);
      await ctx.db
        .update(controllers)
        .set({ secretEnc: encryptSecret(secret, ctx.encKey) })
        .where(eq(controllers.id, c.id));
      ctx.services.gateway.invalidate(c.keyId, c.id, 'credentials changed');
      await audit(ctx, req, 'controller.regenerate_secret', { type: 'controller', id: c.id });
      return { credentials: { keyId: c.keyId, secret } };
    },
  );

  app.post(
    '/controllers/:controllerId/restart',
    { schema: { tags: ['controllers'], params } },
    async (req) => {
      const c = await load(req.params.controllerId);
      await requireHomeRole(ctx, req, c.homeId, 'admin');
      if (
        !ctx.services.gateway.send(c.id, { deviceId: c.keyId, action: controllerActions.restart, value: {} })
      ) {
        throw new AppError(409, 'DEVICE_OFFLINE', 'The board is offline');
      }
      await audit(ctx, req, 'controller.restart', { type: 'controller', id: c.id });
      return { ok: true };
    },
  );

  app.delete(
    '/controllers/:controllerId',
    { schema: { tags: ['controllers'], params } },
    async (req, reply) => {
      const c = await load(req.params.controllerId);
      await requireHomeRole(ctx, req, c.homeId, 'admin');
      const removed = await ctx.db
        .delete(devices)
        .where(eq(devices.controllerId, c.id))
        .returning({ id: devices.id });
      await ctx.db.delete(controllers).where(eq(controllers.id, c.id));
      ctx.services.gateway.invalidate(c.keyId, c.id, 'board removed');
      for (const d of removed) ctx.bus.publishHome(c.homeId, { type: 'device.changed', deviceId: d.id });
      await audit(ctx, req, 'controller.delete', { type: 'controller', id: c.id });
      return reply.code(204).send();
    },
  );
};
