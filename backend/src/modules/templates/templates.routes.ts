import { builtinTemplates, capabilityNames, type DeviceTemplate } from '@voltix/protocol';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { deviceTemplates } from '../../db/schema';
import { requireUser } from '../../lib/access';
import { conflict, notFound } from '../../lib/errors';
import { firmwareSnippet } from './templates.service';

export const templatesRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const allFor = async (userId: string) => {
    const custom = await ctx.db.select().from(deviceTemplates).where(eq(deviceTemplates.ownerUserId, userId));
    return [
      ...builtinTemplates.map((t) => ({ ...t, builtin: true as const })),
      ...custom.map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        icon: t.icon,
        capabilities: t.capabilities,
        builtin: false as const,
      })),
    ];
  };

  app.get('/templates', { schema: { tags: ['templates'] } }, async (req) => ({
    templates: await allFor(requireUser(req)),
    capabilities: capabilityNames,
  }));

  app.post(
    '/templates',
    {
      schema: {
        tags: ['templates'],
        body: z.object({
          key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,31}$/, 'Letters, digits, - and _ only'),
          name: z.string().trim().min(1).max(60),
          icon: z.string().max(40).default('box'),
          capabilities: z
            .array(z.enum(capabilityNames as [string, ...string[]]))
            .min(1)
            .max(12),
        }),
      },
    },
    async (req, reply) => {
      const userId = requireUser(req);
      if (builtinTemplates.some((t) => t.key === req.body.key))
        throw conflict('That key is used by a built-in type');
      const [row] = await ctx.db
        .insert(deviceTemplates)
        .values({ ownerUserId: userId, ...req.body, capabilities: [...new Set(req.body.capabilities)] })
        .onConflictDoNothing()
        .returning();
      if (!row) throw conflict('You already have a template with this key');
      return reply.code(201).send({ template: row });
    },
  );

  app.delete(
    '/templates/:id',
    { schema: { tags: ['templates'], params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      const [row] = await ctx.db
        .delete(deviceTemplates)
        .where(and(eq(deviceTemplates.id, req.params.id), eq(deviceTemplates.ownerUserId, requireUser(req))))
        .returning({ id: deviceTemplates.id });
      if (!row) throw notFound('Template');
      return reply.code(204).send();
    },
  );

  app.post(
    '/templates/firmware',
    {
      schema: {
        tags: ['templates'],
        body: z.object({
          channels: z
            .array(
              z.object({
                channel: z.number().int().min(1).max(32),
                type: z.string().max(32),
                relayPin: z.number().int().min(0).max(48).optional(),
                switchPin: z.number().int().min(0).max(48).optional(),
                switchMode: z.enum(['momentary', 'latching']).optional(),
              }),
            )
            .min(1)
            .max(32),
        }),
      },
    },
    async (req) => {
      const list = await allFor(requireUser(req));
      const map = new Map<string, DeviceTemplate>(list.map((t) => [t.key, t as DeviceTemplate]));
      for (const c of req.body.channels) if (!map.has(c.type)) throw notFound(`Device type "${c.type}"`);
      return { code: firmwareSnippet(req.body.channels, map), filename: 'main.cpp' };
    },
  );
};
