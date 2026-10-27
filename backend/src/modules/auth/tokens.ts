import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../../config/env';
import type { AppContext } from '../../context';
import { refreshTokens, users } from '../../db/schema';
import { randomToken, sha256 } from '../../lib/crypto';
import { unauthorized } from '../../lib/errors';
import { audit } from '../audit/audit';

export const ACCESS_COOKIE = 'vx_at';
export const REFRESH_COOKIE = 'vx_rt';
/** Non-secret flag readable by the web app's middleware to know a session exists. */
export const SESSION_FLAG_COOKIE = 'vx_session';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_S = 30 * 24 * 3600;

const key = (env: Env) => new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(env: Env, user: { id: string; isPlatformAdmin: boolean }) {
  return new SignJWT({ adm: user.isPlatformAdmin })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .setIssuer('voltix')
    .sign(key(env));
}

export async function verifyAccessToken(
  env: Env,
  token: string,
): Promise<{ sub: string; adm: boolean } | null> {
  try {
    const { payload } = await jwtVerify(token, key(env), { issuer: 'voltix', algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? { sub: payload.sub, adm: payload.adm === true } : null;
  } catch {
    return null;
  }
}

function setCookies(ctx: AppContext, reply: FastifyReply, access: string, refresh: string) {
  const secure = ctx.env.COOKIE_SECURE;
  reply
    .setCookie(ACCESS_COOKIE, access, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: ACCESS_TTL_S,
    })
    .setCookie(REFRESH_COOKIE, refresh, {
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: REFRESH_TTL_S,
    })
    .setCookie(SESSION_FLAG_COOKIE, '1', { path: '/', sameSite: 'lax', secure, maxAge: REFRESH_TTL_S });
}

export function clearSessionCookies(reply: FastifyReply) {
  reply
    .clearCookie(ACCESS_COOKIE, { path: '/' })
    .clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH })
    .clearCookie(SESSION_FLAG_COOKIE, { path: '/' });
}

/** Start a new session (new refresh-token family) and set cookies. Returns tokens for bearer clients. */
export async function startSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  user: { id: string; isPlatformAdmin: boolean },
  familyId: string = randomUUID(),
) {
  const refresh = randomToken(32);
  await ctx.db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: sha256(refresh),
    familyId,
    expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
  });
  const access = await signAccessToken(ctx.env, user);
  setCookies(ctx, reply, access, refresh);
  return { accessToken: access, refreshToken: refresh, expiresIn: ACCESS_TTL_S };
}

/**
 * Rotate a refresh token. Reusing an already-rotated token means it was stolen: the whole family
 * (every session descended from that login) is revoked.
 */
export async function rotateSession(
  ctx: AppContext,
  req: FastifyRequest,
  reply: FastifyReply,
  presented: string,
) {
  const [row] = await ctx.db
    .select({ token: refreshTokens, user: users })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(eq(refreshTokens.tokenHash, sha256(presented)))
    .limit(1);
  if (!row) throw unauthorized('Session expired, please sign in again');

  if (row.token.revokedAt) {
    await ctx.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, row.token.familyId), isNull(refreshTokens.revokedAt)));
    await audit(ctx, req, 'auth.refresh_reuse', { type: 'user', id: row.user.id });
    throw unauthorized('Session expired, please sign in again');
  }
  if (row.token.expiresAt < new Date() || row.user.disabledAt) {
    throw unauthorized('Session expired, please sign in again');
  }

  const tokens = await startSession(ctx, req, reply, row.user, row.token.familyId);
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date(), lastUsedAt: new Date() })
    .where(eq(refreshTokens.id, row.token.id));
  return { user: row.user, tokens };
}

export async function revokeFamilyOf(ctx: AppContext, presented: string) {
  const [row] = await ctx.db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(presented)))
    .limit(1);
  if (!row) return;
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
}

export async function revokeAllSessions(ctx: AppContext, userId: string) {
  await ctx.db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
