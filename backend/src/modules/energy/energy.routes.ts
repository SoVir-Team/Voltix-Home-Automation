import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { deviceState, devices, energyDaily, homes } from '../../db/schema';
import { requireHomeRole, requireMemberPermission } from '../../lib/access';
import { notFound } from '../../lib/errors';
import { levelFactor, localDate, splitByLocalDay } from './energy';

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const addMonths = (ymd: string, n: number) => {
  const d = new Date(`${ymd.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

/** kWh not yet written to energy_daily: devices that are on right now, from power_on_since to now. */
async function liveEstimates(ctx: AppContext, homeId: string, tz: string) {
  const rows = await ctx.db
    .select({
      id: devices.id,
      config: devices.config,
      state: deviceState.state,
      since: deviceState.powerOnSince,
    })
    .from(devices)
    .innerJoin(deviceState, eq(deviceState.deviceId, devices.id))
    .where(and(eq(devices.homeId, homeId), sql`${deviceState.powerOnSince} IS NOT NULL`));
  const now = new Date();
  const out: { deviceId: string; day: string; wh: number }[] = [];
  for (const r of rows) {
    const watts = r.config.ratedWatts ?? 0;
    if (!watts || !r.since) continue;
    for (const { day, seconds } of splitByLocalDay(r.since, now, tz)) {
      out.push({ deviceId: r.id, day, wh: (watts * levelFactor(r.state) * seconds) / 3600 });
    }
  }
  return out;
}

export const energyRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get(
    '/homes/:homeId/energy',
    {
      schema: {
        tags: ['energy'],
        params: z.object({ homeId: z.uuid() }),
        querystring: z.object({ range: z.enum(['week', 'month', 'year']).default('month') }),
      },
    },
    async (req) => {
      const access = await requireHomeRole(ctx, req, req.params.homeId);
      requireMemberPermission(access, 'energy');
      const [home] = await ctx.db.select().from(homes).where(eq(homes.id, req.params.homeId));
      if (!home) throw notFound('Home');
      const today = localDate(new Date(), home.timezone);
      const { range } = req.query;

      // Current period + the previous one (for "% vs previous").
      const span = range === 'week' ? 7 : range === 'month' ? 30 : 0;
      const from = range === 'year' ? addMonths(today, -11) : addDays(today, -(span - 1));
      const prevFrom = range === 'year' ? addMonths(today, -23) : addDays(today, -(2 * span - 1));

      const homeDevices = await ctx.db
        .select({ id: devices.id, name: devices.name, type: devices.type, icon: devices.icon })
        .from(devices)
        .where(eq(devices.homeId, home.id));
      const ids = homeDevices.map((d) => d.id);
      const rows = ids.length
        ? await ctx.db
            .select()
            .from(energyDaily)
            .where(
              and(
                inArray(energyDaily.deviceId, ids),
                gte(energyDaily.day, range === 'year' ? `${prevFrom.slice(0, 7)}-01` : prevFrom),
                lte(energyDaily.day, today),
              ),
            )
        : [];
      const entries = [
        ...rows.map((r) => ({ deviceId: r.deviceId, day: r.day, wh: Number(r.whMeasured ?? r.whEstimated) })),
        ...(await liveEstimates(ctx, home.id, home.timezone)),
      ];

      const bucketKey = (day: string) => (range === 'year' ? day.slice(0, 7) : day);
      const buckets = new Map<string, number>();
      if (range === 'year') for (let i = 11; i >= 0; i--) buckets.set(addMonths(today, -i).slice(0, 7), 0);
      else for (let i = span - 1; i >= 0; i--) buckets.set(addDays(today, -i), 0);

      const startKey = range === 'year' ? from.slice(0, 7) : from;
      let total = 0;
      let previous = 0;
      const perDevice = new Map<string, number>();
      for (const e of entries) {
        const key = bucketKey(e.day);
        if (key >= startKey) {
          total += e.wh;
          buckets.set(key, (buckets.get(key) ?? 0) + e.wh);
          perDevice.set(e.deviceId, (perDevice.get(e.deviceId) ?? 0) + e.wh);
        } else {
          previous += e.wh;
        }
      }
      const kwh = (wh: number) => Math.round(wh) / 1000;
      return {
        range,
        currency: home.currency,
        tariffPerKwh: home.tariffPerKwh,
        totalKwh: kwh(total),
        cost: Math.round((total / 1000) * home.tariffPerKwh * 100) / 100,
        previousKwh: kwh(previous),
        changePct: previous > 0 ? Math.round(((total - previous) / previous) * 1000) / 10 : null,
        series: [...buckets].map(([period, wh]) => ({ period, kwh: kwh(wh) })),
        devices: homeDevices
          .map((d) => ({ ...d, kwh: kwh(perDevice.get(d.id) ?? 0) }))
          .filter((d) => d.kwh > 0)
          .sort((a, b) => b.kwh - a.kwh),
      };
    },
  );
};
