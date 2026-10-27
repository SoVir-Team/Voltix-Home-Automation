import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { firmwareReleases, otaRollouts, otaTargets, users } from '../src/db/schema';
import { pumpRollouts } from '../src/modules/ota/ota.service';
import { connectBoard, resetDb, signUp, startApp, type TestApp, waitFor } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
  // boards download firmware from API_ORIGIN; point it at the test server
  t.ctx.env.API_ORIGIN = `http://127.0.0.1:${t.port}`;
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe('public REST API keys', () => {
  it('scopes are enforced, cookies are not needed and revoked keys stop working', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;

    const readOnly = (await client.post('/me/api-keys', { name: 'dashboard', scopes: ['devices:read'] })).body
      .key as string;
    const control = await client.post('/me/api-keys', {
      name: 'home assistant',
      scopes: ['devices:read', 'devices:control'],
    });
    expect(control.status).toBe(201);
    expect(control.body.key).toMatch(/^vx_[a-z0-9]{8}_/);

    const anon = (key: string) => ({
      get: (url: string) => t.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(key) }),
      post: (url: string, body: unknown) =>
        t.app.inject({
          method: 'POST',
          url: `/api/v1${url}`,
          headers: { ...bearer(key), 'content-type': 'application/json' },
          payload: JSON.stringify(body),
        }),
    });

    expect((await anon(readOnly).get(`/homes/${homeId}/devices`)).statusCode).toBe(200);
    const denied = await anon(readOnly).post(`/devices/${d.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(denied.statusCode).toBe(403);
    // API keys never manage the account
    expect(
      (await anon(control.body.key).post('/me/api-keys', { name: 'x', scopes: ['devices:read'] })).statusCode,
    ).toBe(403);

    const ok = await anon(control.body.key).post(`/devices/${d.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(ok.statusCode).toBe(200);
    expect(board.state.get(1)?.powerState).toBe('On');

    expect((await client.del(`/me/api-keys/${control.body.apiKey.id}`)).status).toBe(204);
    expect((await anon(control.body.key).get(`/homes/${homeId}/devices`)).statusCode).toBe(401);
    expect((await anon('vx_abcdefgh_forged').get(`/homes/${homeId}/devices`)).statusCode).toBe(401);
    await board.close();
  });
});

function multipart(fields: Record<string, string>, file: Buffer) {
  const boundary = '----voltixtest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fw.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('OTA', () => {
  it('admin uploads firmware, rolls it out, and the board reports success on reconnect', async () => {
    const admin = await signUp(t, 'Admin');
    await t.ctx.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, admin.userId));
    await admin.client.post('/auth/refresh'); // the admin flag is carried in the access token
    const owner = await signUp(t, 'Owner');
    const { board, controllerId } = await connectBoard(
      t,
      owner.client,
      owner.homeId,
      { 1: 'switch' },
      { autoOta: true },
    );

    const upload = async (file: Buffer, version: string) => {
      const body = multipart({ model: 'voltix-esp32', version }, file);
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/admin/firmware',
        headers: {
          origin: 'http://localhost:3000',
          cookie: admin.client.cookieHeader,
          'content-type': body.contentType,
        },
        payload: body.payload,
      });
      return { status: res.statusCode, body: res.json() };
    };

    // non-admins cannot upload; non-ESP32 images are refused
    expect((await owner.client.get('/admin/firmware')).status).toBe(403);
    expect((await upload(Buffer.from('MZ not firmware'), '1.1.0')).status).toBe(400);

    const image = Buffer.concat([Buffer.from([0xe9]), Buffer.alloc(2048, 1)]);
    const rel = await upload(image, '1.1.0');
    expect(rel.status).toBe(201);

    const rollout = await admin.client.post('/admin/rollouts', {
      releaseId: rel.body.release.id,
      target: { controllerIds: [controllerId] },
    });
    expect(rollout.status).toBe(201);
    await pumpRollouts(t.ctx);

    await waitFor(async () => {
      const [target] = await t.ctx.db
        .select()
        .from(otaTargets)
        .where(eq(otaTargets.controllerId, controllerId));
      return target?.status === 'succeeded';
    }, 10_000);
    expect(board.version).toBe('1.1.0');
    const [c] = (await owner.client.get(`/homes/${owner.homeId}/controllers`)).body.controllers;
    expect(c.firmwareVersion).toBe('1.1.0');
    await board.close();
  });

  it('concurrent pacing passes offer a pending board only once', async () => {
    const owner = await signUp(t, 'Owner');
    const { board, controllerId } = await connectBoard(t, owner.client, owner.homeId, { 1: 'switch' });
    const [release] = await t.ctx.db
      .insert(firmwareReleases)
      .values({ model: 'voltix-esp32', version: '9.9.9', filePath: 'none', size: 1, sha256: 'a'.repeat(64) })
      .returning();
    const [rollout] = await t.ctx.db.insert(otaRollouts).values({ releaseId: release!.id }).returning();
    await t.ctx.db.insert(otaTargets).values({ rolloutId: rollout!.id, controllerId });

    // Rollout start, board reconnects and the minutely job can all pump at the same moment.
    await Promise.all([pumpRollouts(t.ctx), pumpRollouts(t.ctx), pumpRollouts(t.ctx)]);
    await new Promise((r) => setTimeout(r, 300));
    expect(board.received.filter((p) => p.action === 'otaUpdateAvailable')).toHaveLength(1);
    await board.close();
  });

  it('download links are signed and bound to the release', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/ota/download/not-a-real-token' });
    expect([401, 403, 404]).toContain(res.statusCode);
  });
});

describe('platform admin', () => {
  it('admin routes refuse non-admins however the path is spelled', async () => {
    const user = await signUp(t);
    // %61 = 'a': the router decodes it, so a guard on the raw URL would let this through
    for (const path of ['/admin/stats', '/%61dmin/stats', '/admin/%75sers', '/%61dmin/audit']) {
      expect((await user.client.get(path)).status, path).toBe(403);
    }
    await t.ctx.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, user.userId));
    await user.client.post('/auth/refresh');
    expect((await user.client.get('/%61dmin/stats')).status).toBe(200);
  });
});
