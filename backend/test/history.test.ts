import { metrics } from '@voltix/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sensorReadings } from '../src/db/schema';
import { connectBoard, resetDb, signUp, startApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
  await resetDb(t.ctx);
});
afterAll(() => t.close());

describe('sensor history', () => {
  it('the 24h chart ends at the newest reading even when there are more points than the cap', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    // A sensor reporting every 10 s (the fastest allowed) makes 8,640 points a day; 6,000 is past the cap.
    const now = Date.now();
    const rows = Array.from({ length: 6000 }, (_, i) => ({
      deviceId: d.id,
      metric: metrics.temperature,
      ts: new Date(now - (6000 - i) * 10_000),
      value: i,
    }));
    for (let i = 0; i < rows.length; i += 2000)
      await t.ctx.db.insert(sensorReadings).values(rows.slice(i, i + 2000));

    const res = await client.get(`/devices/${d.id}/history?metric=temperature&range=24h`);
    expect(res.status).toBe(200);
    const points = res.body.points as { t: number; v: number }[];
    expect(points.at(-1)!.v).toBe(5999); // newest
    expect(points[0]!.t).toBeLessThan(points.at(-1)!.t); // still oldest-first for the chart
    await board.close();
  });
});
