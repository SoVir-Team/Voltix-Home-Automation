import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { controllers, firmwareReleases, otaRollouts, otaTargets } from '../../db/schema';
import { requireHomeRole, requireUser } from '../../lib/access';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { requirePlatformAdmin } from '../../plugins/auth';
import { audit } from '../audit/audit';
import { compareVersions, createRollout, latestReleases, verifyDownloadToken } from './ota.service';

export { registerOtaHandlers } from './ota.service';

const versionRe = /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?$/;
const ESP32_IMAGE_MAGIC = 0xe9;

export const otaRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const storageDir = resolve(ctx.env.STORAGE_DIR, 'firmware');

  // ── Device download (signed, expiring link; no session) ───────────────────
  app.get(
    '/ota/download/:token',
    {
      config: { public: true, skipOriginCheck: true, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { hide: true, params: z.object({ token: z.string().max(300) }) },
    },
    async (req, reply) => {
      const claim = verifyDownloadToken(ctx, req.params.token);
      if (!claim) throw new AppError(403, 'LINK_EXPIRED', 'Download link is invalid or expired');
      const [release] = await ctx.db
        .select()
        .from(firmwareReleases)
        .where(eq(firmwareReleases.id, claim.releaseId));
      if (!release) throw notFound('Firmware');
      const path = join(storageDir, release.filePath);
      await stat(path).catch(() => {
        throw notFound('Firmware file');
      });
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-length', release.size)
        .header('x-firmware-sha256', release.sha256)
        .send(createReadStream(path));
    },
  );

  // ── Home admins: see and trigger updates for their boards ─────────────────
  app.get(
    '/homes/:homeId/firmware',
    { schema: { tags: ['firmware'], params: z.object({ homeId: z.uuid() }) } },
    async (req) => {
      await requireHomeRole(ctx, req, req.params.homeId, 'admin');
      const boards = await ctx.db.select().from(controllers).where(eq(controllers.homeId, req.params.homeId));
      const latest = new Map((await latestReleases(ctx)).map((r) => [r.model, r]));
      return {
        boards: boards.map((b) => {
          const rel = b.model ? latest.get(b.model) : undefined;
          return {
            controllerId: b.id,
            name: b.name,
            model: b.model,
            currentVersion: b.firmwareVersion,
            online: ctx.services.gateway.isOnline(b.id),
            latest: rel ? { releaseId: rel.id, version: rel.version, notes: rel.notes } : null,
            updateAvailable:
              !!rel && !!b.firmwareVersion && compareVersions(b.firmwareVersion, rel.version) < 0,
          };
        }),
      };
    },
  );

  app.post(
    '/controllers/:controllerId/update',
    { schema: { tags: ['firmware'], params: z.object({ controllerId: z.uuid() }) } },
    async (req) => {
      const [board] = await ctx.db
        .select()
        .from(controllers)
        .where(eq(controllers.id, req.params.controllerId));
      if (!board) throw notFound('Board');
      await requireHomeRole(ctx, req, board.homeId, 'admin');
      const rel = (await latestReleases(ctx)).find((r) => r.model === board.model);
      if (!rel || !board.firmwareVersion || compareVersions(board.firmwareVersion, rel.version) >= 0) {
        throw conflict('This board is already up to date', 'UP_TO_DATE');
      }
      if (!ctx.services.gateway.isOnline(board.id))
        throw new AppError(409, 'DEVICE_OFFLINE', 'The board is offline');
      const result = await createRollout(ctx, rel.id, [board.id], requireUser(req));
      await audit(
        ctx,
        req,
        'ota.update_board',
        { type: 'controller', id: board.id },
        { version: rel.version },
      );
      return result;
    },
  );

  // ── Platform admin: releases and rollouts ─────────────────────────────────
  app.post(
    '/admin/firmware',
    { schema: { tags: ['admin'] }, bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      requirePlatformAdmin(req);
      const file = await req.file();
      if (!file) throw badRequest('Attach a .bin firmware file');
      const fields = Object.fromEntries(
        Object.entries(file.fields).map(([k, v]) => [k, (v as { value?: unknown } | undefined)?.value]),
      );
      const meta = z
        .object({
          model: z.string().regex(/^[a-z0-9-]{2,40}$/),
          version: z.string().regex(versionRe),
          notes: z.string().max(2000).default(''),
        })
        .safeParse(fields);
      if (!meta.success)
        throw badRequest('Model and version (x.y.z) are required', 'VALIDATION_ERROR', meta.error.issues);
      const buf = await file.toBuffer();
      if (file.file.truncated) throw badRequest('Firmware must be at most 4 MB', 'FILE_TOO_LARGE');
      if (buf[0] !== ESP32_IMAGE_MAGIC)
        throw badRequest('This is not an ESP32 firmware image', 'INVALID_IMAGE');
      const sha256 = createHash('sha256').update(buf).digest('hex');
      await mkdir(storageDir, { recursive: true });
      const fileName = `${sha256}.bin`;
      const tmp = join(storageDir, `${fileName}.tmp`);
      await writeFile(tmp, buf);
      await rename(tmp, join(storageDir, fileName));
      const [release] = await ctx.db
        .insert(firmwareReleases)
        .values({ ...meta.data, filePath: fileName, size: buf.length, sha256, uploadedBy: requireUser(req) })
        .onConflictDoNothing()
        .returning();
      if (!release) throw conflict('This model/version already exists');
      await audit(
        ctx,
        req,
        'ota.release_upload',
        { type: 'firmware', id: release.id },
        { model: release.model, version: release.version },
      );
      return reply.code(201).send({ release });
    },
  );

  app.get('/admin/firmware', { schema: { tags: ['admin'] } }, async (req) => {
    requirePlatformAdmin(req);
    return {
      releases: await ctx.db.select().from(firmwareReleases).orderBy(desc(firmwareReleases.createdAt)),
    };
  });

  app.delete(
    '/admin/firmware/:id',
    { schema: { tags: ['admin'], params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      requirePlatformAdmin(req);
      const [rel] = await ctx.db
        .delete(firmwareReleases)
        .where(eq(firmwareReleases.id, req.params.id))
        .returning();
      if (!rel) throw notFound('Release');
      const stillUsed = await ctx.db
        .select({ id: firmwareReleases.id })
        .from(firmwareReleases)
        .where(eq(firmwareReleases.sha256, rel.sha256));
      if (!stillUsed.length) await rm(join(storageDir, rel.filePath), { force: true });
      await audit(ctx, req, 'ota.release_delete', { type: 'firmware', id: rel.id });
      return reply.code(204).send();
    },
  );

  app.post(
    '/admin/rollouts',
    {
      schema: {
        tags: ['admin'],
        body: z.object({
          releaseId: z.uuid(),
          target: z.union([
            z.object({ all: z.literal(true) }),
            z.object({ homeIds: z.array(z.uuid()).min(1).max(1000) }),
            z.object({ controllerIds: z.array(z.uuid()).min(1).max(5000) }),
          ]),
        }),
      },
    },
    async (req, reply) => {
      requirePlatformAdmin(req);
      const [rel] = await ctx.db
        .select()
        .from(firmwareReleases)
        .where(eq(firmwareReleases.id, req.body.releaseId));
      if (!rel) throw notFound('Release');
      const t = req.body.target;
      const boards = await ctx.db
        .select({ id: controllers.id })
        .from(controllers)
        .where(
          and(
            eq(controllers.model, rel.model),
            'homeIds' in t ? inArray(controllers.homeId, t.homeIds) : undefined,
            'controllerIds' in t ? inArray(controllers.id, t.controllerIds) : undefined,
          ),
        );
      const result = await createRollout(
        ctx,
        rel.id,
        boards.map((b) => b.id),
        requireUser(req),
      );
      await audit(
        ctx,
        req,
        'ota.rollout_create',
        { type: 'rollout', id: result.rolloutId },
        { version: rel.version, targets: result.targets },
      );
      return reply.code(201).send(result);
    },
  );

  app.get('/admin/rollouts', { schema: { tags: ['admin'] } }, async (req) => {
    requirePlatformAdmin(req);
    const rows = await ctx.db
      .select({ rollout: otaRollouts, release: firmwareReleases })
      .from(otaRollouts)
      .innerJoin(firmwareReleases, eq(firmwareReleases.id, otaRollouts.releaseId))
      .orderBy(desc(otaRollouts.createdAt))
      .limit(100);
    const ids = rows.map((r) => r.rollout.id);
    const targets = ids.length
      ? await ctx.db.select().from(otaTargets).where(inArray(otaTargets.rolloutId, ids))
      : [];
    return {
      rollouts: rows.map(({ rollout, release }) => {
        const mine = targets.filter((t) => t.rolloutId === rollout.id);
        const counts: Record<string, number> = {};
        for (const t of mine) counts[t.status] = (counts[t.status] ?? 0) + 1;
        return { ...rollout, model: release.model, version: release.version, total: mine.length, counts };
      }),
    };
  });

  app.get(
    '/admin/rollouts/:id',
    { schema: { tags: ['admin'], params: z.object({ id: z.uuid() }) } },
    async (req) => {
      requirePlatformAdmin(req);
      const targets = await ctx.db
        .select({
          target: otaTargets,
          name: controllers.name,
          homeId: controllers.homeId,
          version: controllers.firmwareVersion,
        })
        .from(otaTargets)
        .innerJoin(controllers, eq(controllers.id, otaTargets.controllerId))
        .where(eq(otaTargets.rolloutId, req.params.id));
      return {
        targets: targets.map((t) => ({
          ...t.target,
          name: t.name,
          homeId: t.homeId,
          currentVersion: t.version,
        })),
      };
    },
  );

  app.post(
    '/admin/rollouts/:id/cancel',
    { schema: { tags: ['admin'], params: z.object({ id: z.uuid() }) } },
    async (req) => {
      requirePlatformAdmin(req);
      await ctx.db.update(otaRollouts).set({ status: 'cancelled' }).where(eq(otaRollouts.id, req.params.id));
      await audit(ctx, req, 'ota.rollout_cancel', { type: 'rollout', id: req.params.id });
      return { ok: true };
    },
  );
};
