import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { deviceEvents, devices, rooms, users } from '../../db/schema';
import { requireHomeRole, requireMemberPermission } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { deviceViews, executeAction, permissionArea, sendConfig } from './devices.service';

const deviceParams = z.object({ deviceId: z.uuid() });

export const devicesRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const loadDevice = async (id: string) => {
    const [device] = await ctx.db.select().from(devices).where(eq(devices.id, id)).limit(1);
    if (!device) throw notFound('Device');
    return device;
  };

  app.get(
    '/homes/:homeId/devices',
    {
      config: { apiKeyScope: 'devices:read' },
      schema: { tags: ['devices'], params: z.object({ homeId: z.uuid() }) },
    },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId);
      return { devices: await deviceViews(ctx, eq(devices.homeId, req.params.homeId)) };
    },
  );

  app.get(
    '/devices/:deviceId',
    { config: { apiKeyScope: 'devices:read' }, schema: { tags: ['devices'], params: deviceParams } },
    async (req) => {
      const device = await loadDevice(req.params.deviceId);
      await requireHomeRole(ctx, req, device.homeId);
      const [view] = await deviceViews(ctx, eq(devices.id, device.id));
      return { device: view };
    },
  );

  app.patch(
    '/devices/:deviceId',
    {
      schema: {
        tags: ['devices'],
        params: deviceParams,
        body: z.object({
          name: z.string().trim().min(1).max(60).optional(),
          roomId: z.uuid().nullable().optional(),
          icon: z.string().max(40).optional(),
          favorite: z.boolean().optional(),
          sortOrder: z.number().int().min(0).max(10_000).optional(),
          config: z
            .object({
              ratedWatts: z.number().min(0).max(50_000),
              powerOnBehavior: z.enum(['off', 'last', 'cloud']),
            })
            .partial()
            .optional(),
        }),
      },
    },
    async (req) => {
      const device = await loadDevice(req.params.deviceId);
      const favoriteOnly = Object.keys(req.body).every((k) => k === 'favorite');
      await requireHomeRole(ctx, req, device.homeId, favoriteOnly ? 'member' : 'admin');
      const { config, ...rest } = req.body;
      if (rest.roomId) {
        const [room] = await ctx.db
          .select({ id: rooms.id })
          .from(rooms)
          .where(and(eq(rooms.id, rest.roomId), eq(rooms.homeId, device.homeId)));
        if (!room) throw badRequest('Room belongs to another home', 'INVALID_ROOM');
      }
      await ctx.db
        .update(devices)
        .set({ ...rest, ...(config && { config: { ...device.config, ...config } }) })
        .where(eq(devices.id, device.id));
      if (config?.powerOnBehavior && device.controllerId) await sendConfig(ctx, device.controllerId);
      ctx.bus.publishHome(device.homeId, { type: 'device.changed', deviceId: device.id });
      const [view] = await deviceViews(ctx, eq(devices.id, device.id));
      return { device: view };
    },
  );

  app.delete(
    '/devices/:deviceId',
    { schema: { tags: ['devices'], params: deviceParams } },
    async (req, reply) => {
      const device = await loadDevice(req.params.deviceId);
      await requireHomeRole(ctx, req, device.homeId, 'admin');
      await ctx.db.delete(devices).where(eq(devices.id, device.id));
      if (device.controllerId) await sendConfig(ctx, device.controllerId);
      ctx.bus.publishHome(device.homeId, { type: 'device.changed', deviceId: device.id });
      return reply.code(204).send();
    },
  );

  app.post(
    '/devices/:deviceId/actions',
    {
      config: { apiKeyScope: 'devices:control', rateLimit: { max: 60, timeWindow: '10 seconds' } },
      schema: {
        tags: ['devices'],
        params: deviceParams,
        body: z.object({
          action: z.string().min(1).max(64),
          value: z.record(z.string(), z.unknown()).default({}),
        }),
      },
    },
    async (req) => {
      const device = await loadDevice(req.params.deviceId);
      const access = await requireHomeRole(ctx, req, device.homeId);
      const area = permissionArea(device.type);
      if (area) requireMemberPermission(access, area);
      const state = await executeAction(ctx, device, req.body.action, req.body.value, {
        source: req.auth?.apiKey ? 'api' : 'app',
        actorUserId: req.auth?.userId,
      });
      return { state };
    },
  );

  // ── Activity log ──────────────────────────────────────────────────────────
  const activityQuery = z.object({
    before: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    deviceId: z.uuid().optional(),
  });

  app.get(
    '/homes/:homeId/activity',
    { schema: { tags: ['activity'], params: z.object({ homeId: z.uuid() }), querystring: activityQuery } },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId);
      const { before, limit, deviceId } = req.query;
      const rows = await ctx.db
        .select({
          id: deviceEvents.id,
          at: deviceEvents.at,
          kind: deviceEvents.kind,
          action: deviceEvents.action,
          value: deviceEvents.value,
          source: deviceEvents.source,
          success: deviceEvents.success,
          message: deviceEvents.message,
          deviceId: deviceEvents.deviceId,
          controllerId: deviceEvents.controllerId,
          deviceName: devices.name,
          actorName: users.name,
        })
        .from(deviceEvents)
        .leftJoin(devices, eq(devices.id, deviceEvents.deviceId))
        .leftJoin(users, eq(users.id, deviceEvents.actorUserId))
        .where(
          and(
            eq(deviceEvents.homeId, req.params.homeId),
            deviceId ? eq(deviceEvents.deviceId, deviceId) : undefined,
            before ? lt(deviceEvents.at, new Date(before)) : undefined,
          ),
        )
        .orderBy(desc(deviceEvents.at))
        .limit(limit);
      return { events: rows, nextBefore: rows.length === limit ? rows.at(-1)!.at.getTime() : null };
    },
  );
};
