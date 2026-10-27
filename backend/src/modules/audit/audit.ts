import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { auditLog } from '../../db/schema';

/** Record a security-relevant action. Never throws: auditing must not break the request. */
export async function audit(
  ctx: AppContext,
  req: FastifyRequest | null,
  action: string,
  target?: { type: string; id: string },
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await ctx.db.insert(auditLog).values({
      action,
      actorUserId: req?.auth?.userId ?? null,
      actorApiKeyId: req?.auth?.apiKey?.id ?? null,
      targetType: target?.type ?? null,
      targetId: target?.id ?? null,
      ip: req?.ip ?? null,
      meta,
    });
  } catch (err) {
    ctx.log.error({ err, action }, 'audit write failed');
  }
}
