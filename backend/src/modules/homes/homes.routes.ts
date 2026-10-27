import { and, asc, count, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { controllers, devices, homeInvites, homeMembers, homes, rooms, users } from '../../db/schema';
import { hasRole, requireHomeRole, requireUser } from '../../lib/access';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { actionEmail } from '../../lib/mailer';
import { audit } from '../audit/audit';
import { createHomeFor } from '../auth/auth.routes';

const homeId = z.object({ homeId: z.uuid() });
const timezone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');
const homeBody = z.object({
  name: z.string().trim().min(1).max(80),
  timezone: timezone.optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  tariffPerKwh: z.number().min(0).max(1000).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  memberPermissions: z
    .object({ locks: z.boolean(), energy: z.boolean(), lighting: z.boolean(), climate: z.boolean() })
    .partial()
    .optional(),
});
const roleSchema = z.enum(['owner', 'admin', 'member']);
const roomBody = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(40).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

export const homesRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  // ── Homes ─────────────────────────────────────────────────────────────────
  app.get('/homes', { config: { apiKeyScope: 'homes:read' }, schema: { tags: ['homes'] } }, async (req) => {
    const userId = requireUser(req);
    const rows = await ctx.db
      .select({ home: homes, role: homeMembers.role })
      .from(homeMembers)
      .innerJoin(homes, eq(homes.id, homeMembers.homeId))
      .where(eq(homeMembers.userId, userId))
      .orderBy(asc(homes.createdAt));
    const ids = rows.map((r) => r.home.id);
    const deviceCounts = ids.length
      ? await ctx.db
          .select({ homeId: devices.homeId, n: count() })
          .from(devices)
          .where(inArray(devices.homeId, ids))
          .groupBy(devices.homeId)
      : [];
    const byHome = new Map(deviceCounts.map((d) => [d.homeId, d.n]));
    return { homes: rows.map((r) => ({ ...r.home, role: r.role, deviceCount: byHome.get(r.home.id) ?? 0 })) };
  });

  app.post('/homes', { schema: { tags: ['homes'], body: homeBody } }, async (req, reply) => {
    const userId = requireUser(req);
    const owned = await ctx.db
      .select({ n: count() })
      .from(homeMembers)
      .where(and(eq(homeMembers.userId, userId), eq(homeMembers.role, 'owner')));
    if ((owned[0]?.n ?? 0) >= 20) throw badRequest('You can own at most 20 homes', 'HOME_LIMIT');
    const home = await createHomeFor(ctx, userId, { name: req.body.name, timezone: req.body.timezone }, []);
    const { name: _n, timezone: _t, memberPermissions, ...rest } = req.body;
    const [updated] = await ctx.db
      .update(homes)
      .set({
        ...rest,
        ...(memberPermissions && { memberPermissions: { ...home.memberPermissions, ...memberPermissions } }),
      })
      .where(eq(homes.id, home.id))
      .returning();
    await audit(ctx, req, 'home.create', { type: 'home', id: home.id });
    return reply.code(201).send({ home: { ...updated!, role: 'owner' } });
  });

  app.get(
    '/homes/:homeId',
    { config: { apiKeyScope: 'homes:read' }, schema: { tags: ['homes'], params: homeId } },
    async (req) => {
      const access = await requireHomeRole(ctx, req, req.params.homeId);
      const [home] = await ctx.db.select().from(homes).where(eq(homes.id, req.params.homeId));
      return { home: { ...home!, role: access.role } };
    },
  );

  app.patch(
    '/homes/:homeId',
    { schema: { tags: ['homes'], params: homeId, body: homeBody.partial() } },
    async (req) => {
      const access = await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const { memberPermissions, ...rest } = req.body;
      if (memberPermissions && access.role !== 'owner')
        throw forbidden('Only owners can change member permissions');
      const [home] = await ctx.db
        .update(homes)
        .set({
          ...rest,
          ...(memberPermissions && { memberPermissions: { ...access.permissions, ...memberPermissions } }),
        })
        .where(eq(homes.id, req.params.homeId))
        .returning();
      await audit(
        ctx,
        req,
        'home.update',
        { type: 'home', id: req.params.homeId },
        { fields: Object.keys(req.body) },
      );
      return { home: { ...home!, role: access.role } };
    },
  );

  app.delete('/homes/:homeId', { schema: { tags: ['homes'], params: homeId } }, async (req, reply) => {
    await requireHomeRole(ctx, req, req.params.homeId, 'owner');
    const ctrls = await ctx.db
      .select({ id: controllers.id })
      .from(controllers)
      .where(eq(controllers.homeId, req.params.homeId));
    await ctx.db.delete(homes).where(eq(homes.id, req.params.homeId));
    for (const c of ctrls) ctx.services.gateway.disconnect(c.id, 'home deleted');
    await audit(ctx, req, 'home.delete', { type: 'home', id: req.params.homeId });
    return reply.code(204).send();
  });

  // ── Rooms ─────────────────────────────────────────────────────────────────
  app.get(
    '/homes/:homeId/rooms',
    { config: { apiKeyScope: 'homes:read' }, schema: { tags: ['rooms'], params: homeId } },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId);
      const list = await ctx.db
        .select({
          room: rooms,
          deviceCount: sql<number>`(SELECT count(*)::int FROM devices d WHERE d.room_id = ${rooms.id})`,
        })
        .from(rooms)
        .where(eq(rooms.homeId, req.params.homeId))
        .orderBy(asc(rooms.sortOrder), asc(rooms.createdAt));
      return { rooms: list.map((r) => ({ ...r.room, deviceCount: r.deviceCount })) };
    },
  );

  app.post(
    '/homes/:homeId/rooms',
    { schema: { tags: ['rooms'], params: homeId, body: roomBody } },
    async (req, reply) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const [n] = await ctx.db.select({ n: count() }).from(rooms).where(eq(rooms.homeId, req.params.homeId));
      if ((n?.n ?? 0) >= 100) throw badRequest('A home can have at most 100 rooms', 'ROOM_LIMIT');
      const [room] = await ctx.db
        .insert(rooms)
        .values({ homeId: req.params.homeId, ...req.body })
        .returning();
      return reply.code(201).send({ room: { ...room!, deviceCount: 0 } });
    },
  );

  const loadRoom = async (roomId: string) => {
    const [room] = await ctx.db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    if (!room) throw notFound('Room');
    return room;
  };

  app.patch(
    '/rooms/:roomId',
    { schema: { tags: ['rooms'], params: z.object({ roomId: z.uuid() }), body: roomBody.partial() } },
    async (req) => {
      const room = await loadRoom(req.params.roomId);
      await requireHomeRole(ctx, req, room.homeId, 'admin');
      const [updated] = await ctx.db.update(rooms).set(req.body).where(eq(rooms.id, room.id)).returning();
      return { room: updated };
    },
  );

  app.delete(
    '/rooms/:roomId',
    { schema: { tags: ['rooms'], params: z.object({ roomId: z.uuid() }) } },
    async (req, reply) => {
      const room = await loadRoom(req.params.roomId);
      await requireHomeRole(ctx, req, room.homeId, 'admin');
      await ctx.db.delete(rooms).where(eq(rooms.id, room.id)); // devices keep working, room_id -> NULL
      return reply.code(204).send();
    },
  );

  // ── Members ───────────────────────────────────────────────────────────────
  app.get('/homes/:homeId/members', { schema: { tags: ['members'], params: homeId } }, async (req) => {
    await requireHomeRole(ctx, req, req.params.homeId);
    const members = await ctx.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: homeMembers.role,
        joinedAt: homeMembers.createdAt,
      })
      .from(homeMembers)
      .innerJoin(users, eq(users.id, homeMembers.userId))
      .where(eq(homeMembers.homeId, req.params.homeId))
      .orderBy(asc(homeMembers.createdAt));
    const invites = await ctx.db
      .select({
        id: homeInvites.id,
        email: homeInvites.email,
        role: homeInvites.role,
        expiresAt: homeInvites.expiresAt,
      })
      .from(homeInvites)
      .where(
        and(
          eq(homeInvites.homeId, req.params.homeId),
          isNull(homeInvites.acceptedAt),
          gt(homeInvites.expiresAt, new Date()),
        ),
      );
    return { members, invites };
  });

  const ownerCount = async (hId: string) =>
    (
      await ctx.db
        .select({ n: count() })
        .from(homeMembers)
        .where(and(eq(homeMembers.homeId, hId), eq(homeMembers.role, 'owner')))
    )[0]?.n ?? 0;

  app.patch(
    '/homes/:homeId/members/:userId',
    {
      schema: {
        tags: ['members'],
        params: z.object({ homeId: z.uuid(), userId: z.uuid() }),
        body: z.object({ role: roleSchema }),
      },
    },
    async (req) => {
      const { homeId: hId, userId } = req.params;
      const me = await requireHomeRole(ctx, req, hId, 'admin');
      const [target] = await ctx.db
        .select()
        .from(homeMembers)
        .where(and(eq(homeMembers.homeId, hId), eq(homeMembers.userId, userId)));
      if (!target) throw notFound('Member');
      // Admins manage members/admins; only owners can touch owners or grant ownership.
      if ((target.role === 'owner' || req.body.role === 'owner') && me.role !== 'owner') throw forbidden();
      if (target.role === 'owner' && req.body.role !== 'owner' && (await ownerCount(hId)) <= 1) {
        throw conflict('A home needs at least one owner', 'LAST_OWNER');
      }
      await ctx.db
        .update(homeMembers)
        .set({ role: req.body.role })
        .where(and(eq(homeMembers.homeId, hId), eq(homeMembers.userId, userId)));
      await audit(ctx, req, 'member.role', { type: 'home', id: hId }, { userId, role: req.body.role });
      return { ok: true };
    },
  );

  app.delete(
    '/homes/:homeId/members/:userId',
    { schema: { tags: ['members'], params: z.object({ homeId: z.uuid(), userId: z.uuid() }) } },
    async (req, reply) => {
      const { homeId: hId, userId } = req.params;
      const self = userId === requireUser(req);
      const me = await requireHomeRole(ctx, req, hId, self ? 'member' : 'admin');
      const [target] = await ctx.db
        .select()
        .from(homeMembers)
        .where(and(eq(homeMembers.homeId, hId), eq(homeMembers.userId, userId)));
      if (!target) throw notFound('Member');
      if (!self && !hasRole(me.role, target.role)) throw forbidden();
      if (target.role === 'owner' && (await ownerCount(hId)) <= 1) {
        throw conflict('Transfer ownership before leaving this home', 'LAST_OWNER');
      }
      await ctx.db
        .delete(homeMembers)
        .where(and(eq(homeMembers.homeId, hId), eq(homeMembers.userId, userId)));
      await audit(ctx, req, self ? 'member.leave' : 'member.remove', { type: 'home', id: hId }, { userId });
      return reply.code(204).send();
    },
  );

  // ── Invites ───────────────────────────────────────────────────────────────
  app.post(
    '/homes/:homeId/invites',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
      schema: {
        tags: ['members'],
        params: homeId,
        body: z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'member']) }),
      },
    },
    async (req, reply) => {
      const hId = req.params.homeId;
      await requireHomeRole(ctx, req, hId, 'admin');
      const already = await ctx.db
        .select({ id: users.id })
        .from(homeMembers)
        .innerJoin(users, eq(users.id, homeMembers.userId))
        .where(and(eq(homeMembers.homeId, hId), eq(users.email, req.body.email)));
      if (already.length) throw conflict('This person is already a member', 'ALREADY_MEMBER');
      const token = randomToken(32);
      const [invite] = await ctx.db
        .insert(homeInvites)
        .values({
          homeId: hId,
          email: req.body.email,
          role: req.body.role,
          tokenHash: sha256(token),
          invitedBy: requireUser(req),
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        })
        .returning();
      const [home] = await ctx.db.select({ name: homes.name }).from(homes).where(eq(homes.id, hId));
      const [inviter] = await ctx.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, requireUser(req)));
      await ctx.mailer
        .send({
          to: req.body.email,
          subject: `${inviter?.name ?? 'Someone'} invited you to "${home?.name}" on Voltix`,
          ...actionEmail({
            title: `Join "${home?.name}" on Voltix`,
            intro: `${inviter?.name ?? 'A Voltix user'} invited you to control their smart home as ${req.body.role === 'admin' ? 'an admin' : 'a member'}.`,
            cta: 'Accept invitation',
            url: `${ctx.env.APP_ORIGIN}/invite/${token}`,
            outro: 'This invitation expires in 7 days.',
          }),
        })
        .catch((err) => ctx.log.error({ err }, 'invite email failed'));
      await audit(
        ctx,
        req,
        'member.invite',
        { type: 'home', id: hId },
        { email: req.body.email, role: req.body.role },
      );
      return reply.code(201).send({
        invite: { id: invite!.id, email: invite!.email, role: invite!.role, expiresAt: invite!.expiresAt },
      });
    },
  );

  app.delete(
    '/homes/:homeId/invites/:inviteId',
    { schema: { tags: ['members'], params: z.object({ homeId: z.uuid(), inviteId: z.uuid() }) } },
    async (req, reply) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      await ctx.db
        .delete(homeInvites)
        .where(and(eq(homeInvites.id, req.params.inviteId), eq(homeInvites.homeId, req.params.homeId)));
      return reply.code(204).send();
    },
  );

  app.get(
    '/invites/:token',
    {
      config: { public: true },
      schema: { tags: ['members'], params: z.object({ token: z.string().max(100) }) },
    },
    async (req) => {
      const [row] = await ctx.db
        .select({
          email: homeInvites.email,
          role: homeInvites.role,
          homeName: homes.name,
          expiresAt: homeInvites.expiresAt,
        })
        .from(homeInvites)
        .innerJoin(homes, eq(homes.id, homeInvites.homeId))
        .where(
          and(
            eq(homeInvites.tokenHash, sha256(req.params.token)),
            isNull(homeInvites.acceptedAt),
            gt(homeInvites.expiresAt, new Date()),
          ),
        );
      if (!row) throw notFound('Invitation');
      return { invite: row };
    },
  );

  app.post(
    '/invites/accept',
    { schema: { tags: ['members'], body: z.object({ token: z.string().max(100) }) } },
    async (req) => {
      const userId = requireUser(req);
      const [user] = await ctx.db.select({ email: users.email }).from(users).where(eq(users.id, userId));
      const [invite] = await ctx.db
        .select()
        .from(homeInvites)
        .where(
          and(
            eq(homeInvites.tokenHash, sha256(req.body.token)),
            isNull(homeInvites.acceptedAt),
            gt(homeInvites.expiresAt, new Date()),
          ),
        );
      if (!invite) throw badRequest('This invitation is invalid or has expired', 'TOKEN_INVALID');
      if (invite.email.toLowerCase() !== user?.email.toLowerCase()) {
        throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that email to accept it.`);
      }
      await ctx.db.transaction(async (tx) => {
        await tx.update(homeInvites).set({ acceptedAt: new Date() }).where(eq(homeInvites.id, invite.id));
        await tx
          .insert(homeMembers)
          .values({ homeId: invite.homeId, userId, role: invite.role })
          .onConflictDoNothing();
      });
      await audit(ctx, req, 'member.join', { type: 'home', id: invite.homeId });
      return { homeId: invite.homeId };
    },
  );
};
