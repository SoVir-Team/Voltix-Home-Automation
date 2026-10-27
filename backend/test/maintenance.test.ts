import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Maintenance } from '../src/modules/maintenance/maintenance';
import { startApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());

describe('maintenance', () => {
  it('runs every time and releases its lock while the connection pool is busy', async () => {
    const m = new Maintenance(t.ctx);
    const retention = vi.spyOn(m, 'retention');
    for (let i = 0; i < 10; i++) {
      // other traffic on the pool, like device events and API requests in production
      const busy = Array.from({ length: 4 }, () => t.ctx.sql`SELECT pg_sleep(0.02)`);
      await m.runHourly();
      await Promise.all(busy);
    }
    expect(retention).toHaveBeenCalledTimes(10);
    const [held] = await t.ctx.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 727002`;
    expect(held!.n).toBe(0);
  });
});
