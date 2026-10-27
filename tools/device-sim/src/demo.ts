/**
 * Fill a Voltix account with a realistic demo home and keep its boards online.
 *
 *   DEMO_EMAIL=you@example.com DEMO_PASSWORD=... npx tsx tools/device-sim/src/demo.ts [--api http://localhost:4000]
 *
 * First run creates four boards (living room, bedroom, kitchen, entrance), names their devices and puts them
 * in rooms. Board credentials are kept in tools/device-sim/.demo/<email>.json so later runs reuse them.
 * Sensors report every 15 s; Ctrl+C to stop.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { VirtualBoard } from './board';

const { values } = parseArgs({ options: { api: { type: 'string', default: 'http://localhost:4000' } } });
const API = values.api!;
const email = process.env.DEMO_EMAIL;
const password = process.env.DEMO_PASSWORD;
if (!email || !password) {
  console.error('Set DEMO_EMAIL and DEMO_PASSWORD (an existing Voltix account).');
  process.exit(1);
}

// ── tiny cookie-jar client ──────────────────────────────────────────────────
const jar = new Map<string, string>();
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      origin: process.env.APP_ORIGIN ?? 'http://localhost:3000',
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, v] = pair!.split('=');
    if (k && v !== undefined) jar.set(k.trim(), v);
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

interface Room {
  id: string;
  name: string;
}
interface Device {
  id: string;
  controllerId: string | null;
  channel: number | null;
}
interface BoardPlan {
  name: string;
  room: string;
  roomIcon: string;
  channels: Record<number, [type: string, name: string, watts?: number]>;
}

const plan: BoardPlan[] = [
  {
    name: 'Living room board',
    room: 'Living Room',
    roomIcon: 'sofa',
    channels: {
      1: ['dimSwitch', 'Ceiling Light', 40],
      2: ['switch', 'Smart Lamp', 12],
      3: ['tv', 'Smart TV', 110],
      5: ['fan', 'Ceiling Fan', 75],
      7: ['temperatureSensor', 'Climate Sensor'],
    },
  },
  {
    name: 'Bedroom board',
    room: 'Bedroom',
    roomIcon: 'bed',
    channels: {
      1: ['windowAC', 'Air Conditioner', 1500],
      2: ['light', 'Bedside Light', 9],
      3: ['blinds', 'Window Blinds', 30],
      4: ['temperatureSensor', 'Bedroom Sensor'],
    },
  },
  {
    name: 'Kitchen board',
    room: 'Kitchen',
    roomIcon: 'cooking-pot',
    channels: {
      1: ['switch', 'Kitchen Lights', 36],
      2: ['switch', 'Coffee Machine', 1200],
      3: ['powerSensor', 'Energy Meter'],
      4: ['airQualitySensor', 'Air Quality'],
    },
  },
  {
    name: 'Entrance board',
    room: 'Entrance',
    roomIcon: 'house',
    channels: {
      1: ['lock', 'Front Door'],
      2: ['doorbell', 'Doorbell'],
      3: ['motionSensor', 'Porch Motion'],
      4: ['garageDoor', 'Garage Door'],
    },
  },
];

const here = dirname(fileURLToPath(import.meta.url));
const store = join(here, '..', '.demo', `${email.replace(/[^a-z0-9]/gi, '_')}.json`);
type Saved = Record<string, { keyId: string; secret: string; controllerId: string }>;

async function main() {
  await call('POST', '/auth/login', { email, password });
  const { homes } = await call<{ homes: { id: string; name: string }[] }>('GET', '/homes');
  const home = homes[0]!;
  console.log(`Signed in. Home: ${home.name}`);

  const saved: Saved = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : {};
  const { rooms } = await call<{ rooms: Room[] }>('GET', `/homes/${home.id}/rooms`);
  const roomId = async (name: string, icon: string) => {
    const found = rooms.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const { room } = await call<{ room: Room }>('POST', `/homes/${home.id}/rooms`, { name, icon });
    rooms.push(room);
    return room.id;
  };

  const boards: VirtualBoard[] = [];
  for (const p of plan) {
    let creds = saved[p.name];
    if (!creds) {
      const res = await call<{ controller: { id: string }; credentials: { keyId: string; secret: string } }>(
        'POST',
        `/homes/${home.id}/controllers`,
        { name: p.name },
      );
      creds = { ...res.credentials, controllerId: res.controller.id };
      saved[p.name] = creds;
      mkdirSync(dirname(store), { recursive: true });
      writeFileSync(store, JSON.stringify(saved, null, 2));
    }
    const channels = Object.fromEntries(Object.entries(p.channels).map(([c, [t]]) => [Number(c), t]));
    const board = new VirtualBoard({
      url: `${API.replace(/^http/, 'ws')}/api/v1/device`,
      keyId: creds.keyId,
      secret: creds.secret,
      channels,
      model: 'voltix-esp32',
    });
    await board.connect();
    board.on('command', (c) => console.log(`[${p.name}] <- ${c.action} ${JSON.stringify(c.value)}`));
    board.on('close', () => setTimeout(() => board.connect().catch(() => {}), 3000));
    boards.push(board);

    // Name new devices and put them in the room (only ones still carrying their default name).
    const rid = await roomId(p.room, p.roomIcon);
    const { devices } = await call<{ devices: (Device & { name: string; roomId: string | null })[] }>(
      'GET',
      `/homes/${home.id}/devices`,
    );
    for (const d of devices.filter((x) => x.controllerId === creds.controllerId)) {
      const spec = p.channels[d.channel ?? -1];
      if (!spec || d.roomId) continue;
      await call('PATCH', `/devices/${d.id}`, {
        name: spec[1],
        roomId: rid,
        ...(spec[2] && { config: { ratedWatts: spec[2] } }),
      });
    }
    console.log(`${p.name}: online with ${Object.keys(channels).length} devices`);
  }

  // Live sensor data.
  const [living, bedroom, kitchen, entrance] = boards as [VirtualBoard, VirtualBoard, VirtualBoard, VirtualBoard];
  const wave = (base: number, amp: number) => base + Math.sin(Date.now() / 900_000) * amp + Math.random() * 0.3;
  const tick = () => {
    living.event(7, 'currentTemperature', { temperature: +wave(26, 1.5).toFixed(1), humidity: Math.round(wave(58, 4)) });
    bedroom.event(4, 'currentTemperature', { temperature: +wave(23, 1).toFixed(1), humidity: Math.round(wave(52, 3)) });
    kitchen.event(3, 'powerUsage', { power: Math.round(wave(420, 180)), voltage: +wave(231, 2).toFixed(1), current: +wave(1.8, 0.6).toFixed(2) });
    kitchen.event(4, 'airQuality', { pm1: Math.round(wave(9, 3)), pm2_5: Math.round(wave(22, 8)), pm10: Math.round(wave(38, 10)) });
  };
  tick();
  setInterval(tick, 15_000);
  setInterval(() => {
    if (Math.random() < 0.3) entrance.event(3, 'motion', { state: Math.random() < 0.5 ? 'detected' : 'notDetected' });
  }, 45_000);
  console.log('Demo running. Ctrl+C to stop.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
