import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppContext } from '../context';
import { apiKeys, users } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../modules/auth/tokens';

export type ApiScope = 'homes:read' | 'devices:read' | 'devices:control' | 'scenes:run';
export const apiScopes: ApiScope[] = ['homes:read', 'devices:read', 'devices:control', 'scenes:run'];

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; isPlatformAdmin: boolean; apiKey?: { id: string; scopes: string[] } };
  }
  interface FastifyContextConfig {
    /** Route needs no authentication. */
    public?: boolean;
    /** Route may be called with an API key that has this scope. API keys are refused everywhere else. */
    apiKeyScope?: ApiScope;
    /** Route is called by devices / non-browser clients; skip the Origin check. */
    skipOriginCheck?: boolean;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const API_KEY_RE = /^vx_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;

async function authenticate(ctx: AppContext, req: FastifyRequest): Promise<void> {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;

  const keyMatch = bearer ? API_KEY_RE.exec(bearer) : null;
  if (keyMatch) {
    const [row] = await ctx.db
      .select({ key: apiKeys, isAdmin: users.isPlatformAdmin, disabledAt: users.disabledAt })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(and(eq(apiKeys.prefix, keyMatch[1]!), isNull(apiKeys.revokedAt)))
      .limit(1);
    const valid =
      row &&
      row.key.keyHash === sha256(bearer!) &&
      !row.disabledAt &&
      (!row.key.expiresAt || row.key.expiresAt > new Date());
    if (!valid) throw unauthorized('Invalid API key');
    req.auth = {
      userId: row.key.userId,
      isPlatformAdmin: false, // API keys never carry platform-admin rights
      apiKey: { id: row.key.id, scopes: row.key.scopes },
    };
    if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
      void ctx.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.key.id))
        .catch(() => {});
    }
    return;
  }

  const token = bearer ?? req.cookies[ACCESS_COOKIE];
  if (!token) return;
  const claims = await verifyAccessToken(ctx.env, token);
  if (claims) req.auth = { userId: claims.sub, isPlatformAdmin: claims.adm };
}

export const authPlugin = fp(async (app: FastifyInstance, { ctx }: { ctx: AppContext }) => {
  const allowedOrigin = new URL(ctx.env.APP_ORIGIN).origin;

  app.addHook('onRequest', async (req) => {
    const cfg = req.routeOptions.config;
    // CSRF: browser (cookie) requests that change state must come from the web app's origin.
    if (!SAFE_METHODS.has(req.method) && !req.headers.authorization && !cfg.skipOriginCheck) {
      const origin = req.headers.origin;
      if (origin !== allowedOrigin) throw forbidden('Cross-site request blocked');
    }
    await authenticate(ctx, req);
    if (cfg.public) return;
    if (!req.auth) throw unauthorized();
    const key = req.auth.apiKey;
    if (key && (!cfg.apiKeyScope || !key.scopes.includes(cfg.apiKeyScope))) {
      throw new AppError(403, 'API_KEY_SCOPE', 'This API key is not allowed to call this endpoint');
    }
  });
});

export function requirePlatformAdmin(req: FastifyRequest): void {
  if (!req.auth?.isPlatformAdmin) throw forbidden();
}
