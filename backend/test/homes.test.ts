import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectBoard, resetDb, signUp, startApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

async function inviteAndJoin(owner: Awaited<ReturnType<typeof signUp>>, role: 'admin' | 'member') {
  const guest = await signUp(t, 'Guest');
  const inv = await owner.client.post(`/homes/${owner.homeId}/invites`, { email: guest.email, role });
  expect(inv.status).toBe(201);
  const mail = t.ctx.mailer.sent.find((m) => m.to === guest.email && /invited you/.test(m.subject))!;
  const token = /invite\/([\w-]+)/.exec(mail.text)![1]!;
  const accepted = await guest.client.post('/invites/accept', { token });
  expect(accepted.status).toBe(200);
  return guest;
}

describe('homes, rooms and members', () => {
  it('non-members get 404 (existence is not revealed)', async () => {
    const a = await signUp(t);
    const b = await signUp(t);
    expect((await b.client.get(`/homes/${a.homeId}`)).status).toBe(404);
    expect((await b.client.get(`/homes/${a.homeId}/devices`)).status).toBe(404);
  });

  it('invite flow: only the invited email can accept; members cannot manage the home', async () => {
    const owner = await signUp(t, 'Owner');
    const member = await inviteAndJoin(owner, 'member');
    const members = await owner.client.get(`/homes/${owner.homeId}/members`);
    expect(members.body.members).toHaveLength(2);

    expect((await member.client.post(`/homes/${owner.homeId}/rooms`, { name: 'Garage' })).status).toBe(403);
    expect((await member.client.post(`/homes/${owner.homeId}/controllers`, { name: 'x' })).status).toBe(403);
    expect((await member.client.del(`/homes/${owner.homeId}`)).status).toBe(403);

    // a third user cannot use someone else's invite
    const stranger = await signUp(t, 'Stranger');
    const inv = await owner.client.post(`/homes/${owner.homeId}/invites`, {
      email: 'someone@else.com',
      role: 'member',
    });
    expect(inv.status).toBe(201);
    const mail = t.ctx.mailer.sent.find((m) => m.to === 'someone@else.com')!;
    const token = /invite\/([\w-]+)/.exec(mail.text)![1]!;
    expect((await stranger.client.post('/invites/accept', { token })).status).toBe(403);
  });

  it('admins manage rooms but cannot touch owners; the last owner cannot leave', async () => {
    const owner = await signUp(t, 'Owner');
    const admin = await inviteAndJoin(owner, 'admin');
    expect((await admin.client.post(`/homes/${owner.homeId}/rooms`, { name: 'Garage' })).status).toBe(201);
    expect(
      (await admin.client.patch(`/homes/${owner.homeId}/members/${owner.userId}`, { role: 'member' })).status,
    ).toBe(403);
    expect((await admin.client.del(`/homes/${owner.homeId}/members/${owner.userId}`)).status).toBe(403);
    expect((await owner.client.del(`/homes/${owner.homeId}/members/${owner.userId}`)).status).toBe(409);
    // admin can leave
    expect((await admin.client.del(`/homes/${owner.homeId}/members/${admin.userId}`)).status).toBe(204);
  });

  it('member permissions: owner can stop members controlling locks/lighting', async () => {
    const owner = await signUp(t, 'Owner');
    const member = await inviteAndJoin(owner, 'member');
    const { board } = await connectBoard(t, owner.client, owner.homeId, { 1: 'switch', 2: 'lock' });
    const devices = (await owner.client.get(`/homes/${owner.homeId}/devices`)).body.devices;
    const light = devices.find((d: { type: string }) => d.type === 'switch');
    const lock = devices.find((d: { type: string }) => d.type === 'lock');

    expect(
      (
        await member.client.post(`/devices/${light.id}/actions`, {
          action: 'setPowerState',
          value: { state: 'On' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await owner.client.patch(`/homes/${owner.homeId}`, {
          memberPermissions: { locks: false, lighting: false },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await member.client.post(`/devices/${light.id}/actions`, {
          action: 'setPowerState',
          value: { state: 'Off' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await member.client.post(`/devices/${lock.id}/actions`, {
          action: 'setLockState',
          value: { state: 'unlock' },
        })
      ).status,
    ).toBe(403);
    // admins are never restricted
    expect(
      (
        await owner.client.post(`/devices/${light.id}/actions`, {
          action: 'setPowerState',
          value: { state: 'Off' },
        })
      ).status,
    ).toBe(200);
    await board.close();
  });

  it('rooms: devices can be moved only into rooms of the same home', async () => {
    const a = await signUp(t);
    const b = await signUp(t);
    const { board } = await connectBoard(t, a.client, a.homeId);
    const device = (await a.client.get(`/homes/${a.homeId}/devices`)).body.devices[0];
    const myRoom = (await a.client.get(`/homes/${a.homeId}/rooms`)).body.rooms[0];
    const otherRoom = (await b.client.get(`/homes/${b.homeId}/rooms`)).body.rooms[0];
    expect((await a.client.patch(`/devices/${device.id}`, { roomId: otherRoom.id })).status).toBe(400);
    const moved = await a.client.patch(`/devices/${device.id}`, { roomId: myRoom.id, name: 'Ceiling light' });
    expect(moved.status).toBe(200);
    expect(moved.body.device.roomId).toBe(myRoom.id);
    expect(moved.body.device.name).toBe('Ceiling light');
    await board.close();
  });
});
