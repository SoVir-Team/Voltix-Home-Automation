import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { emailTokens, homeMembers, homes, refreshTokens, rooms, users } from '../../db/schema';
import { requireUser } from '../../lib/access';
import { randomToken, sha256 } from '../../lib/crypto';
import { AppError, badRequest, conflict, notFound, tooMany, unauthorized } from '../../lib/errors';
import { actionEmail } from '../../lib/mailer';
import { audit } from '../audit/audit';
import { hashPassword, passwordSchema, timingSafeDummyVerify, verifyPassword } from './password';
import {
  clearSessionCookies,
  REFRESH_COOKIE,
  revokeAllSessions,
  revokeFamilyOf,
  rotateSession,
  startSession,
} from './tokens';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const nameSchema = z.string().trim().min(1).max(80);

export const publicUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  emailVerified: !!u.emailVerifiedAt,
  isPlatformAdmin: u.isPlatformAdmin,
  createdAt: u.createdAt,
});

/** Per-email failed-login limiter: 5 failures per 15 minutes. In-memory (single process). */
const failures = new Map<string, { count: number; until: number }>();
const LOGIN_WINDOW_MS = 15 * 60_000;
function checkLoginAllowed(email: string) {
  const f = failures.get(email);
  if (f && f.until > Date.now() && f.count >= 5)
    throw tooMany('Too many failed sign-ins. Try again in 15 minutes.');
}
function recordFailure(email: string) {
  const f = failures.get(email);
  if (!f || f.until < Date.now()) failures.set(email, { count: 1, until: Date.now() + LOGIN_WINDOW_MS });
  else f.count++;
  if (failures.size > 50_000) failures.clear(); // shortcut: bounded memory; Redis if ever multi-instance
}

async function issueEmailToken(ctx: AppContext, userId: string, purpose: 'verify' | 'reset') {
  const token = randomToken(32);
  await ctx.db.insert(emailTokens).values({
    userId,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + (purpose === 'verify' ? 24 : 1) * 3600_000),
  });
  return token;
}

async function consumeEmailToken(ctx: AppContext, token: string, purpose: 'verify' | 'reset') {
  const [row] = await ctx.db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailTokens.tokenHash, sha256(token)),
        eq(emailTokens.purpose, purpose),
        isNull(emailTokens.usedAt),
        gt(emailTokens.expiresAt, new Date()),
      ),
    )
    .returning({ userId: emailTokens.userId });
  if (!row) throw badRequest('This link is invalid or has expired', 'TOKEN_INVALID');
  return row.userId;
}

async function sendVerification(ctx: AppContext, user: { id: string; email: string; name: string }) {
  const token = await issueEmailToken(ctx, user.id, 'verify');
  const url = `${ctx.env.APP_ORIGIN}/verify-email?token=${token}`;
  await ctx.mailer.send({
    to: user.email,
    subject: 'Confirm your Voltix email',
    ...actionEmail({
      title: `Welcome to Voltix, ${user.name}`,
      intro: 'Confirm your email address to secure your account.',
      cta: 'Confirm email',
      url,
      outro: 'This link expires in 24 hours.',
    }),
  });
}

/** Create a home with the user as owner and a few starter rooms. */
export async function createHomeFor(
  ctx: AppContext,
  userId: string,
  name: string,
  starterRooms = ['Living Room', 'Kitchen', 'Bedroom'],
) {
  return ctx.db.transaction(async (tx) => {
    const [home] = await tx
      .insert(homes)
      .values({ name, createdBy: userId }) // timezone: column default Asia/Kolkata

      .returning();
    await tx.insert(homeMembers).values({ homeId: home!.id, userId, role: 'owner' });
    if (starterRooms.length) {
      await tx
        .insert(rooms)
        .values(
          starterRooms.map((name, i) => ({ homeId: home!.id, name, sortOrder: i, icon: roomIcon(name) })),
        );
    }
    return home!;
  });
}

const roomIcon = (name: string) =>
  /kitchen/i.test(name)
    ? 'cooking-pot'
    : /bed/i.test(name)
      ? 'bed-double'
      : /bath/i.test(name)
        ? 'bath'
        : 'sofa';

export const authRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post(
    '/auth/register',
    {
      config: { public: true, ...authLimit },
      schema: {
        tags: ['auth'],
        body: z.object({
          name: nameSchema,
          email: emailSchema,
          password: passwordSchema,
        }),
      },
    },
    async (req, reply) => {
      const { name, email, password } = req.body;
      const existing = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing.length) throw conflict('An account with this email already exists', 'EMAIL_TAKEN');
      const [user] = await ctx.db
        .insert(users)
        .values({ name, email, passwordHash: await hashPassword(password) })
        .returning();
      await createHomeFor(ctx, user!.id, 'My Home');
      await sendVerification(ctx, user!).catch((err) => ctx.log.error({ err }, 'verification email failed'));
      await audit(ctx, req, 'auth.register', { type: 'user', id: user!.id });
      if (ctx.env.REQUIRE_EMAIL_VERIFICATION) {
        return reply.code(201).send({ user: publicUser(user!), verificationRequired: true });
      }
      const tokens = await startSession(ctx, req, reply, user!);
      return reply.code(201).send({ user: publicUser(user!), verificationRequired: false, ...tokens });
    },
  );

  app.post(
    '/auth/login',
    {
      config: { public: true, ...authLimit },
      schema: {
        tags: ['auth'],
        body: z.object({ email: emailSchema, password: z.string().min(1).max(128) }),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      checkLoginAllowed(email);
      const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user) {
        await timingSafeDummyVerify(password);
        recordFailure(email);
        throw unauthorized('Incorrect email or password');
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        recordFailure(email);
        await audit(ctx, req, 'auth.login_failed', { type: 'user', id: user.id });
        throw unauthorized('Incorrect email or password');
      }
      if (user.disabledAt) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');
      if (ctx.env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
        throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please confirm your email first');
      }
      failures.delete(email);
      const tokens = await startSession(ctx, req, reply, user);
      await audit(ctx, req, 'auth.login', { type: 'user', id: user.id });
      return { user: publicUser(user), ...tokens };
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: { public: true, rateLimit: { max: 60, timeWindow: '1 minute' } },
      // Browsers send no body at all (Fastify passes null): the cookie carries the token.
      schema: { tags: ['auth'], body: z.object({ refreshToken: z.string().optional() }).nullish() },
    },
    async (req, reply) => {
      const presented = req.body?.refreshToken ?? req.cookies[REFRESH_COOKIE];
      if (!presented) throw unauthorized();
      try {
        const { user, tokens } = await rotateSession(ctx, req, reply, presented);
        return { user: publicUser(user), ...tokens };
      } catch (err) {
        clearSessionCookies(reply);
        throw err;
      }
    },
  );

  app.post('/auth/logout', { config: { public: true }, schema: { tags: ['auth'] } }, async (req, reply) => {
    const presented = req.cookies[REFRESH_COOKIE];
    if (presented) await revokeFamilyOf(ctx, presented);
    clearSessionCookies(reply);
    return reply.code(204).send();
  });

  app.post(
    '/auth/verify-email',
    {
      config: { public: true, ...authLimit },
      schema: { tags: ['auth'], body: z.object({ token: z.string().max(100) }) },
    },
    async (req) => {
      const userId = await consumeEmailToken(ctx, req.body.token, 'verify');
      await ctx.db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
      await audit(ctx, req, 'auth.email_verified', { type: 'user', id: userId });
      return { ok: true };
    },
  );

  app.post('/auth/resend-verification', { config: authLimit, schema: { tags: ['auth'] } }, async (req) => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, requireUser(req)))
      .limit(1);
    if (user && !user.emailVerifiedAt) await sendVerification(ctx, user);
    return { ok: true };
  });

  app.post(
    '/auth/forgot-password',
    {
      config: { public: true, ...authLimit },
      schema: { tags: ['auth'], body: z.object({ email: emailSchema }) },
    },
    async (req, reply) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.email, req.body.email)).limit(1);
      if (user && !user.disabledAt) {
        const token = await issueEmailToken(ctx, user.id, 'reset');
        await ctx.mailer
          .send({
            to: user.email,
            subject: 'Reset your Voltix password',
            ...actionEmail({
              title: 'Reset your password',
              intro: 'We received a request to reset your Voltix password.',
              cta: 'Choose a new password',
              url: `${ctx.env.APP_ORIGIN}/reset-password?token=${token}`,
              outro: "This link expires in 1 hour. If you didn't ask for this, you can ignore this email.",
            }),
          })
          .catch((err) => ctx.log.error({ err }, 'reset email failed'));
        await audit(ctx, req, 'auth.reset_requested', { type: 'user', id: user.id });
      }
      // Same answer whether or not the email exists (no account enumeration).
      return reply.code(202).send({ ok: true });
    },
  );

  app.post(
    '/auth/reset-password',
    {
      config: { public: true, ...authLimit },
      schema: { tags: ['auth'], body: z.object({ token: z.string().max(100), password: passwordSchema }) },
    },
    async (req) => {
      const userId = await consumeEmailToken(ctx, req.body.token, 'reset');
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(req.body.password),
          updatedAt: new Date(),
          emailVerifiedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await revokeAllSessions(ctx, userId);
      await audit(ctx, req, 'auth.password_reset', { type: 'user', id: userId });
      return { ok: true };
    },
  );

  // ── Current user ──────────────────────────────────────────────────────────
  app.get('/me', { schema: { tags: ['account'] } }, async (req) => {
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, requireUser(req)))
      .limit(1);
    if (!user) throw unauthorized();
    return { user: publicUser(user) };
  });

  app.patch('/me', { schema: { tags: ['account'], body: z.object({ name: nameSchema }) } }, async (req) => {
    const [user] = await ctx.db
      .update(users)
      .set({ name: req.body.name, updatedAt: new Date() })
      .where(eq(users.id, requireUser(req)))
      .returning();
    return { user: publicUser(user!) };
  });

  app.post(
    '/me/password',
    {
      config: authLimit,
      schema: {
        tags: ['account'],
        body: z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }),
      },
    },
    async (req, reply) => {
      const userId = requireUser(req);
      const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
        throw badRequest('Current password is incorrect', 'WRONG_PASSWORD');
      }
      await ctx.db
        .update(users)
        .set({ passwordHash: await hashPassword(req.body.newPassword), updatedAt: new Date() })
        .where(eq(users.id, userId));
      await revokeAllSessions(ctx, userId);
      await audit(ctx, req, 'auth.password_changed', { type: 'user', id: userId });
      const tokens = await startSession(ctx, req, reply, user);
      return { ok: true, ...tokens };
    },
  );

  app.get('/me/sessions', { schema: { tags: ['account'] } }, async (req) => {
    const rows = await ctx.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, requireUser(req)),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(refreshTokens.createdAt))
      .limit(50);
    const current = req.cookies[REFRESH_COOKIE] ? sha256(req.cookies[REFRESH_COOKIE]) : null;
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
        current: r.tokenHash === current,
      })),
    };
  });

  app.delete(
    '/me/sessions/:id',
    { schema: { tags: ['account'], params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      const [row] = await ctx.db
        .select({ familyId: refreshTokens.familyId })
        .from(refreshTokens)
        .where(and(eq(refreshTokens.id, req.params.id), eq(refreshTokens.userId, requireUser(req))))
        .limit(1);
      if (!row) throw notFound('Session');
      await ctx.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      return reply.code(204).send();
    },
  );
};
