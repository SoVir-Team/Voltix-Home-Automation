import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { notificationPrefs, notifications, pushSubscriptions } from '../../db/schema';
import { requireUser } from '../../lib/access';
import { defaultPrefs, notificationTypes } from './notifications.service';

export const notificationsRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notifications'],
        querystring: z.object({
          before: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
      },
    },
    async (req) => {
      const userId = requireUser(req);
      const rows = await ctx.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            req.query.before ? lt(notifications.createdAt, new Date(req.query.before)) : undefined,
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(req.query.limit);
      const unread = await ctx.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
        .limit(100);
      return { notifications: rows, unreadCount: unread.length };
    },
  );

  app.post(
    '/notifications/read',
    { schema: { tags: ['notifications'], body: z.object({ ids: z.array(z.uuid()).max(100).optional() }) } },
    async (req) => {
      const userId = requireUser(req);
      await ctx.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            req.body.ids ? inArray(notifications.id, req.body.ids) : undefined,
          ),
        );
      return { ok: true };
    },
  );

  app.get('/notifications/prefs', { schema: { tags: ['notifications'] } }, async (req) => {
    const rows = await ctx.db
      .select()
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, requireUser(req)));
    const saved = new Map(rows.map((r) => [r.type, r]));
    return {
      prefs: notificationTypes.map((type) => {
        const p = saved.get(type) ?? defaultPrefs[type];
        return { type, inApp: p.inApp, push: p.push, email: p.email };
      }),
      pushAvailable: !!ctx.env.VAPID_PUBLIC_KEY,
    };
  });

  app.put(
    '/notifications/prefs',
    {
      schema: {
        tags: ['notifications'],
        body: z.object({
          prefs: z
            .array(
              z.object({
                type: z.enum(notificationTypes),
                inApp: z.boolean(),
                push: z.boolean(),
                email: z.boolean(),
              }),
            )
            .max(notificationTypes.length),
        }),
      },
    },
    async (req) => {
      const userId = requireUser(req);
      for (const p of req.body.prefs) {
        await ctx.db
          .insert(notificationPrefs)
          .values({ userId, ...p })
          .onConflictDoUpdate({
            target: [notificationPrefs.userId, notificationPrefs.type],
            set: { inApp: p.inApp, push: p.push, email: p.email },
          });
      }
      return { ok: true };
    },
  );

  app.get(
    '/push/vapid-public-key',
    { config: { public: true }, schema: { tags: ['notifications'] } },
    async () => ({
      publicKey: ctx.env.VAPID_PUBLIC_KEY || null,
    }),
  );

  app.post(
    '/push/subscriptions',
    {
      schema: {
        tags: ['notifications'],
        body: z.object({
          endpoint: z.string().url().max(1000).startsWith('https://'),
          keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
        }),
      },
    },
    async (req, reply) => {
      const userId = requireUser(req);
      await ctx.db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: req.body.endpoint,
          p256dh: req.body.keys.p256dh,
          auth: req.body.keys.auth,
          userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId, p256dh: req.body.keys.p256dh, auth: req.body.keys.auth },
        });
      return reply.code(201).send({ ok: true });
    },
  );

  app.delete(
    '/push/subscriptions',
    { schema: { tags: ['notifications'], body: z.object({ endpoint: z.string().max(1000) }) } },
    async (req, reply) => {
      await ctx.db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, req.body.endpoint),
            eq(pushSubscriptions.userId, requireUser(req)),
          ),
        );
      return reply.code(204).send();
    },
  );
};
