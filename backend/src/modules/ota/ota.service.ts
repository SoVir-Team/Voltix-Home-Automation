import { createHmac } from 'node:crypto';
import { controllerActions, otaStatusValueSchema, type Payload, safeEqual } from '@voltix/protocol/node';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { controllers, firmwareReleases, otaRollouts, otaTargets } from '../../db/schema';
import { connectedHandlers, controllerEventHandlers } from '../devices/devices.service';
import type { ControllerAuth, HandshakeMeta } from '../gateway/gateway';

/** Max boards updating at the same time (protects the server and limits blast radius of a bad build). */
export const MAX_IN_FLIGHT = 20;
const OTA_TIMEOUT_MS = 15 * 60_000;
const LINK_TTL_S = 15 * 60;
const IN_FLIGHT = ['offered', 'downloading', 'installing'] as const;

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// ── Signed, expiring download links (stateless) ─────────────────────────────
const sign = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function downloadToken(ctx: AppContext, releaseId: string, controllerId: string): string {
  const exp = Math.floor(Date.now() / 1000) + LINK_TTL_S;
  const data = `${releaseId}.${controllerId}.${exp}`;
  return `${data}.${sign(ctx.env.JWT_SECRET, `ota:${data}`)}`;
}

export function verifyDownloadToken(
  ctx: AppContext,
  token: string,
): { releaseId: string; controllerId: string } | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [releaseId, controllerId, exp, sig] = parts as [string, string, string, string];
  if (!safeEqual(sig, sign(ctx.env.JWT_SECRET, `ota:${releaseId}.${controllerId}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return { releaseId, controllerId };
}

// ── Rollout pacing ──────────────────────────────────────────────────────────
async function offer(ctx: AppContext, rolloutId: string, controllerId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ release: firmwareReleases, keyId: controllers.keyId })
    .from(otaRollouts)
    .innerJoin(firmwareReleases, eq(firmwareReleases.id, otaRollouts.releaseId))
    .innerJoin(controllers, eq(controllers.id, controllerId))
    .where(eq(otaRollouts.id, rolloutId));
  if (!row) return false;
  // Claim the target before sending: several pacing passes can run at once (rollout start, board reconnect,
  // the minutely job), and only one of them may offer.
  const target = and(eq(otaTargets.rolloutId, rolloutId), eq(otaTargets.controllerId, controllerId));
  const claimed = await ctx.db
    .update(otaTargets)
    .set({ status: 'offered', progress: 0, error: null, offeredAt: new Date(), updatedAt: new Date() })
    .where(and(target, eq(otaTargets.status, 'pending')))
    .returning({ controllerId: otaTargets.controllerId });
  if (!claimed.length) return false;
  const url = `${ctx.env.API_ORIGIN}/api/v1/ota/download/${downloadToken(ctx, row.release.id, controllerId)}`;
  const sent = ctx.services.gateway.send(controllerId, {
    deviceId: row.keyId,
    action: controllerActions.otaUpdateAvailable,
    value: {
      url,
      version: row.release.version,
      size: row.release.size,
      sha256: row.release.sha256,
      forceUpdate: false,
    },
  });
  if (!sent) {
    await ctx.db.update(otaTargets).set({ status: 'pending', updatedAt: new Date() }).where(target);
    return false;
  }
  return true;
}

/** Offer pending targets to online boards while keeping at most MAX_IN_FLIGHT updating per rollout. */
export async function pumpRollouts(ctx: AppContext): Promise<void> {
  const active = await ctx.db.select().from(otaRollouts).where(eq(otaRollouts.status, 'active'));
  for (const r of active) {
    const targets = await ctx.db.select().from(otaTargets).where(eq(otaTargets.rolloutId, r.id));
    const inFlight = targets.filter((t) => (IN_FLIGHT as readonly string[]).includes(t.status)).length;
    const pending = targets.filter((t) => t.status === 'pending');
    if (!inFlight && !pending.length) {
      await ctx.db.update(otaRollouts).set({ status: 'completed' }).where(eq(otaRollouts.id, r.id));
      continue;
    }
    let slots = MAX_IN_FLIGHT - inFlight;
    for (const t of pending) {
      if (slots <= 0) break;
      if (!ctx.services.gateway.isOnline(t.controllerId)) continue;
      if (await offer(ctx, r.id, t.controllerId)) slots--;
    }
  }
}

export async function sweepOtaTimeouts(ctx: AppContext): Promise<void> {
  await ctx.db
    .update(otaTargets)
    .set({ status: 'timeout', error: 'No update confirmation within 15 minutes', updatedAt: new Date() })
    .where(
      and(
        inArray(otaTargets.status, [...IN_FLIGHT]),
        lt(otaTargets.offeredAt, new Date(Date.now() - OTA_TIMEOUT_MS)),
      ),
    );
}

async function publishProgress(
  ctx: AppContext,
  homeId: string,
  rolloutId: string,
  controllerId: string,
  status: string,
  progress: number,
) {
  ctx.bus.publishHome(homeId, { type: 'ota.progress', controllerId, rolloutId, status, progress });
}

/** On (re)connect: a board reporting the target version has finished; otherwise it may get an offer. */
async function onConnected(ctx: AppContext, auth: ControllerAuth, meta: HandshakeMeta): Promise<void> {
  const rows = await ctx.db
    .select({ target: otaTargets, version: firmwareReleases.version })
    .from(otaTargets)
    .innerJoin(otaRollouts, eq(otaRollouts.id, otaTargets.rolloutId))
    .innerJoin(firmwareReleases, eq(firmwareReleases.id, otaRollouts.releaseId))
    .where(
      and(
        eq(otaTargets.controllerId, auth.controllerId),
        eq(otaRollouts.status, 'active'),
        inArray(otaTargets.status, ['pending', ...IN_FLIGHT]),
      ),
    );
  for (const { target, version } of rows) {
    if (meta.version && compareVersions(meta.version, version) >= 0) {
      await ctx.db
        .update(otaTargets)
        .set({ status: 'succeeded', progress: 100, updatedAt: new Date() })
        .where(
          and(eq(otaTargets.rolloutId, target.rolloutId), eq(otaTargets.controllerId, auth.controllerId)),
        );
      await publishProgress(ctx, auth.homeId, target.rolloutId, auth.controllerId, 'succeeded', 100);
    } else if (target.status !== 'pending') {
      // Board rebooted mid-update without the new version: retry from the start.
      await ctx.db
        .update(otaTargets)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(
          and(eq(otaTargets.rolloutId, target.rolloutId), eq(otaTargets.controllerId, auth.controllerId)),
        );
    }
  }
  if (rows.length) await pumpRollouts(ctx);
}

const statusMap = {
  accepted: 'downloading',
  downloading: 'downloading',
  verifying: 'installing',
  installing: 'installing',
  rejected: 'failed',
  failed: 'failed',
} as const;

async function onOtaStatus(ctx: AppContext, auth: ControllerAuth, p: Payload): Promise<void> {
  const parsed = otaStatusValueSchema.safeParse(p.value);
  if (!parsed.success) return;
  const v = parsed.data;
  const [row] = await ctx.db
    .select({ rolloutId: otaTargets.rolloutId })
    .from(otaTargets)
    .innerJoin(otaRollouts, eq(otaRollouts.id, otaTargets.rolloutId))
    .innerJoin(firmwareReleases, eq(firmwareReleases.id, otaRollouts.releaseId))
    .where(
      and(
        eq(otaTargets.controllerId, auth.controllerId),
        eq(otaRollouts.status, 'active'),
        eq(firmwareReleases.version, v.version),
        inArray(otaTargets.status, [...IN_FLIGHT]),
      ),
    )
    .limit(1);
  if (!row) return;
  const status = statusMap[v.status];
  const progress = v.progress ?? (status === 'installing' ? 100 : 0);
  // Only move a target that is still in flight: the board may already have rebooted into the new version and
  // been marked succeeded by its reconnect while this event was being processed.
  const updated = await ctx.db
    .update(otaTargets)
    .set({ status, progress, error: v.error ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(otaTargets.rolloutId, row.rolloutId),
        eq(otaTargets.controllerId, auth.controllerId),
        inArray(otaTargets.status, [...IN_FLIGHT]),
      ),
    )
    .returning({ status: otaTargets.status });
  if (!updated.length) return;
  await publishProgress(ctx, auth.homeId, row.rolloutId, auth.controllerId, status, progress);
  if (status === 'failed') await pumpRollouts(ctx);
}

/** Hook OTA into board connects and otaStatus events. Idempotent (tests build several apps). */
export function registerOtaHandlers(): void {
  if (controllerEventHandlers.has(controllerActions.otaStatus)) return;
  connectedHandlers.push(onConnected);
  controllerEventHandlers.set(controllerActions.otaStatus, onOtaStatus);
}

/** Create a rollout of `releaseId` to the given boards (skipping ones already on that version). */
export async function createRollout(
  ctx: AppContext,
  releaseId: string,
  controllerIds: string[],
  createdBy: string,
): Promise<{ rolloutId: string; targets: number }> {
  const [release] = await ctx.db.select().from(firmwareReleases).where(eq(firmwareReleases.id, releaseId));
  if (!release) throw new Error('release not found');
  const boards = controllerIds.length
    ? await ctx.db
        .select({ id: controllers.id, version: controllers.firmwareVersion, model: controllers.model })
        .from(controllers)
        .where(inArray(controllers.id, controllerIds))
    : [];
  const eligible = boards.filter(
    (b) =>
      (!b.model || b.model === release.model) &&
      (!b.version || compareVersions(b.version, release.version) < 0),
  );
  const [rollout] = await ctx.db.insert(otaRollouts).values({ releaseId, createdBy }).returning();
  if (eligible.length) {
    await ctx.db
      .insert(otaTargets)
      .values(eligible.map((b) => ({ rolloutId: rollout!.id, controllerId: b.id })));
  }
  await pumpRollouts(ctx);
  return { rolloutId: rollout!.id, targets: eligible.length };
}

export const latestReleases = (ctx: AppContext) =>
  ctx.db.execute<{ id: string; model: string; version: string; notes: string; created_at: Date }>(sql`
    SELECT DISTINCT ON (model) id, model, version, notes, created_at
    FROM firmware_releases ORDER BY model, created_at DESC`);
