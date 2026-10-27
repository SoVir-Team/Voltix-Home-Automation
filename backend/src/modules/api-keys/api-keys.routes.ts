import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { apiKeys } from '../../db/schema';
import { requireUser } from '../../lib/access';
import { randomToken, sha256 } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import { apiScopes } from '../../plugins/auth';
import { audit } from '../audit/audit';

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const newPrefix = () =>
  Array.from(randomBytes(8), (b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join('');

/** Personal API keys for integrations (Home Assistant, Node-RED, scripts). Shown once, stored hashed. */
export const apiKeysRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get('/me/api-keys', { schema: { tags: ['api-keys'] } }, async (req) => {
    const rows = await ctx.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, requireUser(req)), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
    return { apiKeys: rows, availableScopes: apiScopes };
  });

  app.post(
    '/me/api-keys',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
      schema: {
        tags: ['api-keys'],
        body: z.object({
          name: z.string().trim().min(1).max(60),
          scopes: z.array(z.enum(apiScopes as [string, ...string[]])).min(1),
          expiresInDays: z.number().int().min(1).max(3650).optional(),
        }),
      },
    },
    async (req, reply) => {
      const userId = requireUser(req);
      const [n] = await ctx.db
        .select({ n: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
      if ((n?.n ?? 0) >= 20) throw badRequest('You can have at most 20 active API keys', 'API_KEY_LIMIT');
      const prefix = newPrefix();
      const key = `vx_${prefix}_${randomToken(32)}`;
      const [row] = await ctx.db
        .insert(apiKeys)
        .values({
          userId,
          name: req.body.name,
          prefix,
          keyHash: sha256(key),
          scopes: [...new Set(req.body.scopes)],
          expiresAt: req.body.expiresInDays
            ? new Date(Date.now() + req.body.expiresInDays * 86_400_000)
            : null,
        })
        .returning();
      await audit(ctx, req, 'api_key.create', { type: 'api_key', id: row!.id }, { scopes: row!.scopes });
      return reply.code(201).send({
        apiKey: { id: row!.id, name: row!.name, prefix, scopes: row!.scopes, expiresAt: row!.expiresAt },
        key,
      });
    },
  );

  app.delete(
    '/me/api-keys/:id',
    { schema: { tags: ['api-keys'], params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      const [row] = await ctx.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, requireUser(req)), isNull(apiKeys.revokedAt)),
        )
        .returning({ id: apiKeys.id });
      if (!row) throw notFound('API key');
      await audit(ctx, req, 'api_key.revoke', { type: 'api_key', id: row.id });
      return reply.code(204).send();
    },
  );
};
