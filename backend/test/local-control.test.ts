import { type ConfigValue, controllerActions, localPinVerifier } from '@voltix/protocol/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectBoard, resetDb, signUp, startApp, type TestApp, waitFor } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

const lastConfig = (board: { received: { action: string; value: unknown }[] }) =>
  board.received.filter((p) => p.action === controllerActions.config).at(-1)?.value as ConfigValue;

describe('local control (home Wi-Fi without internet)', () => {
  it('PIN: 6-8 digits, admins only, never returned', async () => {
    const owner = await signUp(t);
    const url = `/homes/${owner.homeId}`;
    expect((await owner.client.get(url)).body.home.localPinSet).toBe(false);

    for (const bad of ['12345', '123456789', '12a456', 1234567])
      expect((await owner.client.patch(url, { localPin: bad })).status).toBe(400);

    const set = await owner.client.patch(url, { localPin: '246810' });
    expect(set.status).toBe(200);
    expect(set.body.home.localPinSet).toBe(true);
    expect(JSON.stringify(set.body)).not.toContain('246810');
    expect(set.body.home).not.toHaveProperty('localPinEnc');
    const list = (await owner.client.get('/homes')).body.homes;
    expect(list[0].localPinSet).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/localPinEnc|246810/);

    const guest = await signUp(t, 'Guest');
    const inv = await owner.client.post(`${url}/invites`, { email: guest.email, role: 'member' });
    const mail = t.ctx.mailer.sent.find((m) => m.to === guest.email && /invited you/.test(m.subject))!;
    await guest.client.post('/invites/accept', { token: /invite\/([\w-]+)/.exec(mail.text)![1] });
    expect(inv.status).toBe(201);
    expect((await guest.client.patch(url, { localPin: '135790' })).status).toBe(403);

    const off = await owner.client.patch(url, { localPin: null });
    expect(off.body.home.localPinSet).toBe(false);
  });

  it('board gets channel names and the PIN verifier, and a new PIN right away', async () => {
    const { client, homeId } = await signUp(t);
    const { board, secret, controllerId } = await connectBoard(
      t,
      client,
      homeId,
      { 1: 'switch', 2: 'switch' },
      { lanIp: '192.168.1.23', localName: 'voltix-a1b2.local' },
    );
    expect(lastConfig(board).localPinHash).toBeNull();

    // the handshake stored where the local page lives
    const ctrl = (await client.get(`/controllers/${controllerId}`)).body.controller;
    expect(ctrl).toMatchObject({ lanIp: '192.168.1.23', localName: 'voltix-a1b2.local' });

    await client.patch(`/homes/${homeId}`, { localPin: '246810' });
    await waitFor(() => lastConfig(board).localPinHash === localPinVerifier(secret, '246810'));

    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices.filter(
      (x: { channel: number }) => x.channel === 2,
    );
    await client.patch(`/devices/${d.id}`, { name: 'Porch light' });
    await waitFor(() => lastConfig(board).channels.some((c) => c.channel === 2 && c.name === 'Porch light'));

    await client.patch(`/homes/${homeId}`, { localPin: null });
    await waitFor(() => lastConfig(board).localPinHash === null);
    await board.close();
  });

  it('ignores malformed local address headers', async () => {
    const { client, homeId } = await signUp(t);
    const { board, controllerId } = await connectBoard(
      t,
      client,
      homeId,
      { 1: 'switch' },
      { lanIp: 'not-an-ip', localName: '<script>.local' },
    );
    const ctrl = (await client.get(`/controllers/${controllerId}`)).body.controller;
    expect(ctrl).toMatchObject({ lanIp: null, localName: null });
    await board.close();
  });

  it('a change made on the local page is recorded as source "local"', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    board.event(1, 'setPowerState', { state: 'On' }, undefined, 'local');
    await waitFor(async () => {
      const events = (await client.get(`/homes/${homeId}/activity`)).body.events;
      return events.some((e: { source: string }) => e.source === 'local');
    });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    expect(d.state.powerState).toBe('On');
    await board.close();
  });
});
