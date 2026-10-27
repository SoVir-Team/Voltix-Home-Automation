import { metricNames, metrics } from '@voltix/protocol';
import { and, asc, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { devices, sensorReadings, sensorRollupsHourly } from '../../db/schema';
import { requireHomeRole } from '../../lib/access';
import { notFound } from '../../lib/errors';

const RANGES = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '1y': 24 * 365 } as const;

export const telemetryRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  app.get(
    '/devices/:deviceId/history',
    {
      config: { apiKeyScope: 'devices:read' },
      schema: {
        tags: ['telemetry'],
        params: z.object({ deviceId: z.uuid() }),
        querystring: z.object({
          metric: z.enum(metricNames as [string, ...string[]]),
          range: z.enum(['24h', '7d', '30d', '1y']).default('24h'),
        }),
      },
    },
    async (req) => {
      const [device] = await ctx.db.select().from(devices).where(eq(devices.id, req.params.deviceId));
      if (!device) throw notFound('Device');
      await requireHomeRole(ctx, req, device.homeId);
      const metric = metrics[req.query.metric as keyof typeof metrics];
      const since = new Date(Date.now() - RANGES[req.query.range] * 3600_000);

      // Raw points for the last day; hourly rollups (min/avg/max) beyond that keep payloads small.
      if (req.query.range === '24h') {
        const rows = await ctx.db
          .select({ ts: sensorReadings.ts, value: sensorReadings.value })
          .from(sensorReadings)
          .where(
            and(
              eq(sensorReadings.deviceId, device.id),
              eq(sensorReadings.metric, metric),
              gte(sensorReadings.ts, since),
            ),
          )
          .orderBy(asc(sensorReadings.ts))
          .limit(5000);
        return { metric: req.query.metric, points: rows.map((r) => ({ t: r.ts.getTime(), v: r.value })) };
      }
      const rows = await ctx.db
        .select()
        .from(sensorRollupsHourly)
        .where(
          and(
            eq(sensorRollupsHourly.deviceId, device.id),
            eq(sensorRollupsHourly.metric, metric),
            gte(sensorRollupsHourly.hour, since),
          ),
        )
        .orderBy(asc(sensorRollupsHourly.hour))
        .limit(10_000);
      return {
        metric: req.query.metric,
        points: rows.map((r) => ({ t: r.hour.getTime(), v: r.avg, min: r.min, max: r.max })),
      };
    },
  );
};
