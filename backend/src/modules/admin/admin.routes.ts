import { count, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { auditLog, controllers, devices, homes, users } from '../../db/schema';
import { requireUser } from '../../lib/access';
import { badRequest, notFound } from '../../lib/errors';
import { requirePlatformAdmin } from '../../plugins/auth';
import { audit } from '../audit/audit';
import { revokeAllSessions } from '../auth/tokens';

/** Platform operations for Voltix staff (is_platform_admin). */
export const adminRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  // Scoped to this plugin's routes. Never test req.url here: it is the raw path, so /api/v1/%61dmin/... would
  // route to /admin/... while slipping past a prefix check.
  app.addHook('onRequest', async (req) => requirePlatformAdmin(req));

  app.get('/admin/stats', { schema: { tags: ['admin'] } }, async () => {
    const [u] = await ctx.db.select({ n: count() }).from(users);
    const [h] = await ctx.db.select({ n: count() }).from(homes);
    const [c] = await ctx.db.select({ n: count() }).from(controllers);
    const [d] = await ctx.db.select({ n: count() }).from(devices);
    const [size] = await ctx.sql<
      { bytes: string }[]
    >`SELECT pg_database_size(current_database())::text AS bytes`;
    const partitions = await ctx.sql<{ name: string }[]>`
      SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid ORDER BY 1`;
    return {
      users: u?.n ?? 0,
      homes: h?.n ?? 0,
      boards: c?.n ?? 0,
      boardsOnline: ctx.services.gateway.connectionCount,
      devices: d?.n ?? 0,
      databaseBytes: Number(size?.bytes ?? 0),
      partitions: partitions.map((p) => p.name),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      uptimeS: Math.round(process.uptime()),
    };
  });

  app.get(
    '/admin/users',
    {
      schema: {
        tags: ['admin'],
        querystring: z.object({
          q: z.string().max(100).optional(),
          page: z.coerce.number().int().min(1).default(1),
        }),
      },
    },
    async (req) => {
      const q = req.query.q?.trim();
      const where = q ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`)) : undefined;
      const rows = await ctx.db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerifiedAt: users.emailVerifiedAt,
          isPlatformAdmin: users.isPlatformAdmin,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
          homes: sql<number>`(SELECT count(*)::int FROM home_members m WHERE m.user_id = ${users.id})`,
        })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(50)
        .offset((req.query.page - 1) * 50);
      return { users: rows };
    },
  );

  app.patch(
    '/admin/users/:id',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.uuid() }),
        body: z.object({ disabled: z.boolean().optional(), isPlatformAdmin: z.boolean().optional() }),
      },
    },
    async (req) => {
      if (req.params.id === requireUser(req))
        throw badRequest('You cannot change your own admin account here');
      const [user] = await ctx.db
        .update(users)
        .set({
          ...(req.body.disabled !== undefined && { disabledAt: req.body.disabled ? new Date() : null }),
          ...(req.body.isPlatformAdmin !== undefined && { isPlatformAdmin: req.body.isPlatformAdmin }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, req.params.id))
        .returning({ id: users.id });
      if (!user) throw notFound('User');
      // Admin rights ride in the access token: end sessions so a demotion takes effect at the next refresh.
      if (req.body.disabled || req.body.isPlatformAdmin === false) await revokeAllSessions(ctx, user.id);
      await audit(ctx, req, 'admin.user_update', { type: 'user', id: user.id }, req.body);
      return { ok: true };
    },
  );

  app.get('/admin/homes', { schema: { tags: ['admin'] } }, async () => {
    const rows = await ctx.db
      .select({
        id: homes.id,
        name: homes.name,
        timezone: homes.timezone,
        createdAt: homes.createdAt,
        members: sql<number>`(SELECT count(*)::int FROM home_members m WHERE m.home_id = ${homes.id})`,
        boards: sql<number>`(SELECT count(*)::int FROM controllers c WHERE c.home_id = ${homes.id})`,
        devices: sql<number>`(SELECT count(*)::int FROM devices d WHERE d.home_id = ${homes.id})`,
        ownerEmail: sql<string>`(SELECT u.email FROM home_members m JOIN users u ON u.id = m.user_id WHERE m.home_id = ${homes.id} AND m.role = 'owner' LIMIT 1)`,
      })
      .from(homes)
      .orderBy(desc(homes.createdAt))
      .limit(500);
    return { homes: rows };
  });

  app.get('/admin/boards', { schema: { tags: ['admin'] } }, async () => {
    const rows = await ctx.db
      .select({
        id: controllers.id,
        name: controllers.name,
        homeId: controllers.homeId,
        homeName: homes.name,
        model: controllers.model,
        firmwareVersion: controllers.firmwareVersion,
        lastSeenAt: controllers.lastSeenAt,
      })
      .from(controllers)
      .innerJoin(homes, eq(homes.id, controllers.homeId))
      .orderBy(desc(controllers.lastSeenAt))
      .limit(5000);
    return { boards: rows.map((r) => ({ ...r, online: ctx.services.gateway.isOnline(r.id) })) };
  });

  app.get(
    '/admin/audit',
    { schema: { tags: ['admin'], querystring: z.object({ before: z.coerce.number().int().optional() }) } },
    async (req) => {
      const rows = await ctx.db
        .select({ entry: auditLog, actorEmail: users.email })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .where(req.query.before ? lt(auditLog.id, req.query.before) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(100);
      return { entries: rows.map((r) => ({ ...r.entry, actorEmail: r.actorEmail })) };
    },
  );
};
