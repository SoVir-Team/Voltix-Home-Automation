import { VirtualBoard } from '@voltix/device-sim';
import { encodeMessage, handshakeSignature, newPayload } from '@voltix/protocol/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { connectBoard, openRealtime, resetDb, signUp, startApp, type TestApp, waitFor } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp({ offlineGraceMs: 200 });
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

const deviceUrl = () => `ws://127.0.0.1:${t.port}/api/v1/device`;

describe('device gateway', () => {
  it('auto-creates channel devices, round-trips commands and streams physical presses live', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch', 2: 'switch', 5: 'fan' });

    const list = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    expect(list.map((d: { channel: number; type: string }) => `${d.channel}:${d.type}`).sort()).toEqual([
      '1:switch',
      '2:switch',
      '5:fan',
    ]);
    expect(list.every((d: { online: boolean }) => d.online)).toBe(true);
    expect(board.deviceByChannel.size).toBe(3);

    const light = list.find((d: { channel: number }) => d.channel === 1);
    const res = await client.post(`/devices/${light.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(res.status).toBe(200);
    expect(res.body.state.powerState).toBe('On');
    expect(board.state.get(1)?.powerState).toBe('On');

    // invalid values never reach the board
    const before = board.received.length;
    expect(
      (
        await client.post(`/devices/${light.id}/actions`, {
          action: 'setPowerState',
          value: { state: 'Maybe' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await client.post(`/devices/${light.id}/actions`, {
          action: 'setThermostatMode',
          value: { thermostatMode: 'COOL' },
        })
      ).status,
    ).toBe(400);
    expect(board.received.length).toBe(before);

    // wall switch -> browser
    const rt = await openRealtime(t, client, homeId);
    board.pressSwitch(1);
    await waitFor(() =>
      rt.messages.some(
        (m) => m.type === 'device.state' && m.deviceId === light.id && m.state.powerState === 'Off',
      ),
    );
    const activity = (await client.get(`/homes/${homeId}/activity`)).body.events;
    expect(activity.some((e: { source: string }) => e.source === 'physical')).toBe(true);

    rt.ws.close();
    await board.close();
  });

  it('device rejection is 422, a hung board is 504', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' }, { failActions: true });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    const rejected = await client.post(`/devices/${d.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe('DEVICE_REJECTED');
    board.opts.failActions = false;
    board.opts.silent = true;
    const hung = await client.post(`/devices/${d.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(hung.status).toBe(504);
    await board.close();
  });

  it('goes offline after the grace period and answers 409 while offline', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    const rt = await openRealtime(t, client, homeId);
    board.kill();
    await waitFor(() => rt.messages.some((m) => m.type === 'device.online' && m.online === false));
    const off = await client.post(`/devices/${d.id}/actions`, {
      action: 'setPowerState',
      value: { state: 'On' },
    });
    expect(off.status).toBe(409);
    expect((await client.get(`/devices/${d.id}`)).body.device.online).toBe(false);
    rt.ws.close();
  });

  it('a quick reconnect inside the grace period is not reported as offline', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const rt = await openRealtime(t, client, homeId);
    board.kill();
    await board.connect();
    await new Promise((r) => setTimeout(r, 400));
    expect(rt.messages.some((m) => m.type === 'device.online' && m.online === false)).toBe(false);
    rt.ws.close();
    await board.close();
  });

  it('rejects bad handshakes with 401 before upgrading', async () => {
    const { client, homeId } = await signUp(t);
    const { keyId, secret, board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    await board.close();

    const wrong = new VirtualBoard({
      url: deviceUrl(),
      keyId,
      secret: `${secret.slice(0, -2)}xx`,
      channels: { 1: 'switch' },
    });
    await expect(wrong.connect()).rejects.toThrow(/401/);

    // valid signature but a timestamp outside the window
    const ts = Math.floor(Date.now() / 1000) - 600;
    const stale = new WebSocket(deviceUrl(), {
      headers: {
        'x-voltix-key': keyId,
        'x-voltix-ts': String(ts),
        'x-voltix-sig': handshakeSignature(secret, keyId, ts),
      },
    });
    const status = await new Promise<number | undefined>((r) => {
      stale.once('unexpected-response', (_q, res) => r(res.statusCode));
      stale.once('open', () => r(101));
    });
    expect(status).toBe(401);

    // regenerated secret invalidates the old one
    const regen = await client.post(
      `/controllers/${(await client.get(`/homes/${homeId}/controllers`)).body.controllers[0].id}/regenerate-secret`,
    );
    expect(regen.status).toBe(200);
    const old = new VirtualBoard({ url: deviceUrl(), keyId, secret, channels: { 1: 'switch' } });
    await expect(old.connect()).rejects.toThrow(/401/);
  });

  it('limits handshakes per board, not per IP', async () => {
    const { client, homeId } = await signUp(t);
    // 35 boards behind one address (one big home, or several homes behind carrier NAT) all get in.
    const boards = await Promise.all(
      Array.from({ length: 35 }, () => connectBoard(t, client, homeId, { 1: 'switch' }).then((r) => r.board)),
    );
    expect(boards).toHaveLength(35);
    await Promise.all(boards.map((b) => b.close()));

    // One board stuck in a reconnect loop is cut off.
    const { keyId, secret, board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    await board.close();
    const attempt = () => {
      const ts = Math.floor(Date.now() / 1000);
      const ws = new WebSocket(deviceUrl(), {
        headers: {
          'x-voltix-key': keyId,
          'x-voltix-ts': String(ts),
          'x-voltix-sig': handshakeSignature(secret, keyId, ts),
          'x-voltix-channels': '1:switch',
        },
      });
      return new Promise<number | undefined>((r) => {
        ws.once('unexpected-response', (_q, res) => r(res.statusCode));
        ws.once('open', () => {
          ws.close();
          r(101);
        });
      });
    };
    const statuses: (number | undefined)[] = [];
    for (let i = 0; i < 12; i++) statuses.push(await attempt());
    expect(statuses.slice(0, 11).every((s) => s === 101)).toBe(true);
    expect(statuses[11]).toBe(429);
  });

  it('ignores tampered, replayed and stale device messages', async () => {
    const { client, homeId } = await signUp(t);
    const { board, secret } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const deviceId = board.deviceByChannel.get(1)!;
    const event = (createdAt?: number) =>
      newPayload({
        action: 'setPowerState',
        clientId: 'physical',
        deviceId,
        type: 'event',
        value: { state: 'On' },
        ...(createdAt && { createdAt }),
      });
    const current = async () => (await client.get(`/devices/${deviceId}`)).body.device.state.powerState;

    board.sendRaw(encodeMessage(event(), 'not-the-secret-0123456789abcdef0123456789'));
    board.sendRaw(encodeMessage(event(Math.floor(Date.now() / 1000) - 300), secret));
    const tampered = encodeMessage(event(), secret).replace('"On"', '"Off"');
    board.sendRaw(tampered);
    await new Promise((r) => setTimeout(r, 200));
    expect(await current()).not.toBe('On');

    const good = encodeMessage(event(), secret);
    board.sendRaw(good);
    await waitFor(async () => (await current()) === 'On');
    // replay the exact same signed message after the state moved on
    await client.post(`/devices/${deviceId}/actions`, { action: 'setPowerState', value: { state: 'Off' } });
    board.sendRaw(good);
    await new Promise((r) => setTimeout(r, 200));
    expect(await current()).toBe('Off');
    await board.close();
  });

  it('a second connection with the same key replaces the first', async () => {
    const { client, homeId } = await signUp(t);
    const { board, keyId, secret } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const closed = new Promise<number>((r) => board.once('close', (code: number) => r(code)));
    const twin = new VirtualBoard({ url: deviceUrl(), keyId, secret, channels: { 1: 'switch' } });
    await twin.connect();
    expect(await closed).toBe(4001);
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    expect(
      (await client.post(`/devices/${d.id}/actions`, { action: 'setPowerState', value: { state: 'On' } }))
        .status,
    ).toBe(200);
    expect(twin.state.get(1)?.powerState).toBe('On');
    await twin.close();
  });
});
