import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { automations, deviceState, devices, energyDaily } from '../src/db/schema';
import { MAX_DEPTH } from '../src/modules/automations/engine';
import { applyState } from '../src/modules/devices/state.service';
import { Maintenance } from '../src/modules/maintenance/maintenance';
import { connectBoard, resetDb, signUp, startApp, type TestApp, waitFor } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

describe('scenes, automations and energy', () => {
  it('scenes run every step and report per-device results', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch', 2: 'switch' });
    const [a, b] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    const scene = await client.post(`/homes/${homeId}/scenes`, {
      name: 'Movie',
      actions: [
        { deviceId: a.id, action: 'setPowerState', value: { state: 'On' } },
        { deviceId: b.id, action: 'setPowerState', value: { state: 'On' } },
      ],
    });
    expect(scene.status).toBe(201);
    const run = await client.post(`/scenes/${scene.body.scene.id}/run`);
    expect(run.status).toBe(200);
    expect(board.state.get(1)?.powerState).toBe('On');
    expect(board.state.get(2)?.powerState).toBe('On');

    // steps that point at another home's device are refused
    const other = await signUp(t);
    const bad = await other.client.post(`/homes/${other.homeId}/scenes`, {
      name: 'Steal',
      actions: [{ deviceId: a.id, action: 'setPowerState', value: { state: 'Off' } }],
    });
    expect(bad.status).toBe(400);
    await board.close();
  });

  it('a window schedule turns a device on at start and off at end via the ticker', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    const created = await client.post(`/homes/${homeId}/automations`, {
      name: 'Porch light',
      trigger: { kind: 'window', start: '18:00', end: '23:00' },
      actions: [{ kind: 'device', deviceId: d.id, action: 'setPowerState', value: { state: 'On' } }],
      endActions: [{ kind: 'device', deviceId: d.id, action: 'setPowerState', value: { state: 'Off' } }],
    });
    expect(created.status).toBe(201);
    const id = created.body.automation.id;
    const engine = t.ctx.services.automations;
    // This test drives the clock itself; a background tick in flight would make tick() a silent no-op.
    engine.stop();
    const row = async () => (await t.ctx.db.select().from(automations).where(eq(automations.id, id)))[0]!;

    const first = await row();
    expect(first.nextRunAt).toBeTruthy();
    await engine.tick(new Date(first.nextRunAt!.getTime() + 1000));
    const expected = first.nextEdge === 'start' ? 'On' : 'Off';
    await waitFor(() => board.state.get(1)?.powerState === expected);

    const second = await row();
    expect(second.nextEdge).not.toBe(first.nextEdge);
    await engine.tick(new Date(second.nextRunAt!.getTime() + 1000));
    await waitFor(() => board.state.get(1)?.powerState === (expected === 'On' ? 'Off' : 'On'));

    // a run missed by more than the misfire window is skipped, not replayed late
    const third = await row();
    const before = board.received.length;
    await engine.tick(new Date(third.nextRunAt!.getTime() + 60 * 60_000));
    await new Promise((r) => setTimeout(r, 200));
    expect(board.received.length).toBe(before);
    await board.close();
    await engine.start();
  });

  it('device triggers use hysteresis and the loop guard stops ping-pong chains', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, {
      1: 'temperatureSensor',
      2: 'switch',
      3: 'switch',
    });
    const list = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    const sensor = list.find((x: { channel: number }) => x.channel === 1);
    const fan = list.find((x: { channel: number }) => x.channel === 2);
    const lamp = list.find((x: { channel: number }) => x.channel === 3);

    expect(
      (
        await client.post(`/homes/${homeId}/automations`, {
          name: 'Hot -> fan on',
          cooldownS: 0,
          trigger: {
            kind: 'device',
            deviceId: sensor.id,
            key: 'temperature',
            op: 'gt',
            value: 30,
            hysteresis: 2,
          },
          actions: [{ kind: 'device', deviceId: fan.id, action: 'setPowerState', value: { state: 'On' } }],
        })
      ).status,
    ).toBe(201);

    // The first reading goes through the real board; telemetry is then rate-limited (1 per 10 s per device),
    // so later readings are applied through the same state path the gateway uses.
    board.event(1, 'currentTemperature', { temperature: 25 });
    await waitFor(
      async () => (await client.get(`/devices/${sensor.id}`)).body.device.state.temperature === 25,
    );
    const [sensorRow] = await t.ctx.db.select().from(devices).where(eq(devices.id, sensor.id));
    const push = (temperature: number) =>
      applyState(
        t.ctx,
        sensorRow!,
        { temperature },
        { source: 'system', kind: 'event', action: 'currentTemperature', value: { temperature } },
      );
    const fanCommands = () => board.received.filter((p) => p.deviceId === fan.id).length;
    await push(31);
    await waitFor(() => fanCommands() === 1);
    await push(30.5); // still hot, no re-fire
    await push(29.5); // inside the hysteresis band: not re-armed
    await push(31);
    await new Promise((r) => setTimeout(r, 200));
    expect(fanCommands()).toBe(1);
    await push(27); // below 30 - 2: re-armed
    await push(31);
    await waitFor(() => fanCommands() === 2);

    // Four rules that chase each other forever (fan On -> lamp On -> fan Off -> lamp Off -> fan On ...)
    // are cut off by the depth guard.
    const rule = (from: { id: string }, when: string, to: { id: string }, set: string) =>
      client.post(`/homes/${homeId}/automations`, {
        name: `${when}->${set}`,
        cooldownS: 0,
        trigger: { kind: 'device', deviceId: from.id, key: 'powerState', op: 'eq', value: when },
        actions: [{ kind: 'device', deviceId: to.id, action: 'setPowerState', value: { state: set } }],
      });
    await client.post(`/devices/${fan.id}/actions`, { action: 'setPowerState', value: { state: 'Off' } });
    await client.post(`/devices/${lamp.id}/actions`, { action: 'setPowerState', value: { state: 'Off' } });
    expect((await rule(fan, 'On', lamp, 'On')).status).toBe(201);
    await rule(lamp, 'On', fan, 'Off');
    await rule(fan, 'Off', lamp, 'Off');
    await rule(lamp, 'Off', fan, 'On');
    const start = board.received.length;
    await client.post(`/devices/${fan.id}/actions`, { action: 'setPowerState', value: { state: 'On' } });
    await new Promise((r) => setTimeout(r, 1000));
    const sent = board.received.length - start;
    expect(sent).toBeGreaterThanOrEqual(2); // the chain did start
    expect(sent).toBeLessThanOrEqual(1 + MAX_DEPTH); // ...and stopped
    await board.close();
  });

  it('accrues estimated energy while a device is on and reports it per device', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    await client.patch(`/devices/${d.id}`, { config: { ratedWatts: 3600 } });
    await client.post(`/devices/${d.id}/actions`, { action: 'setPowerState', value: { state: 'On' } });
    await new Promise((r) => setTimeout(r, 1100));
    await client.post(`/devices/${d.id}/actions`, { action: 'setPowerState', value: { state: 'Off' } });
    const rows = await t.ctx.db.select().from(energyDaily).where(eq(energyDaily.deviceId, d.id));
    const wh = rows.reduce((s, r) => s + r.whEstimated, 0);
    expect(wh).toBeGreaterThan(0.9); // 3600 W for ~1.1 s ≈ 1.1 Wh
    expect(wh).toBeLessThan(2);
    const report = await client.get(`/homes/${homeId}/energy?range=week`);
    expect(report.status).toBe(200);
    expect(report.body.devices.find((x: { id: string }) => x.id === d.id)?.kwh).toBeGreaterThan(0);
    await board.close();
  });

  it('the hourly job books energy for devices that stay on', async () => {
    const { client, homeId } = await signUp(t);
    const { board } = await connectBoard(t, client, homeId, { 1: 'switch' });
    const [d] = (await client.get(`/homes/${homeId}/devices`)).body.devices;
    await client.patch(`/devices/${d.id}`, { config: { ratedWatts: 100 } });
    await client.post(`/devices/${d.id}/actions`, { action: 'setPowerState', value: { state: 'On' } });
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
    await t.ctx.db
      .update(deviceState)
      .set({ powerOnSince: twoHoursAgo })
      .where(eq(deviceState.deviceId, d.id));

    await new Maintenance(t.ctx).closeEnergyIntervals(new Date());

    const rows = await t.ctx.db.select().from(energyDaily).where(eq(energyDaily.deviceId, d.id));
    expect(rows.reduce((s, r) => s + r.whEstimated, 0)).toBeCloseTo(200, 0); // 100 W for 2 h
    const [st] = await t.ctx.db.select().from(deviceState).where(eq(deviceState.deviceId, d.id));
    expect(Date.now() - st!.powerOnSince!.getTime()).toBeLessThan(60_000); // interval restarted
    await board.close();
  });
});
