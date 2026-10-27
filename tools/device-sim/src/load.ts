/**
 * Load test: thousands of virtual boards against one backend.
 *
 *   npx tsx --env-file=backend/.env backend/src/db/seed-load.ts --homes 150 --boards 20   # once
 *   npx tsx tools/device-sim/src/load.ts [--api http://localhost:4000] [--boards 3000] [--duration 120]
 *
 * Phases:
 *   1. connect: open boards at --ramp per second; time from socket open to config.
 *   2. steady: every board sends telemetry every --telemetry s; 10% press a wall switch each minute;
 *      --commands REST commands per second go to random boards and their round trip is timed.
 *   3. storm: every socket is cut at once; boards reconnect after a random 1-10 s (as the firmware does).
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { VirtualBoard } from './board';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:4000' },
    fleet: { type: 'string', default: 'tools/device-sim/.load/fleet.json' },
    boards: { type: 'string' },
    ramp: { type: 'string', default: '100' },
    duration: { type: 'string', default: '120' },
    telemetry: { type: 'string', default: '30' },
    commands: { type: 'string', default: '4' },
    storm: { type: 'boolean', default: true },
  },
});
const API = values.api!;
const WS = `${API.replace(/^http/, 'ws')}/api/v1/device`;
const fleet = JSON.parse(readFileSync(values.fleet!, 'utf8')) as {
  apiKey: string;
  boards: { keyId: string; secret: string; homeId: string }[];
};
const creds = fleet.boards.slice(0, values.boards ? Number(values.boards) : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stats(xs: number[]) {
  if (!xs.length) return 'n=0';
  const s = [...xs].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(0);
  return `n=${s.length} p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms max=${s[s.length - 1]!.toFixed(0)}ms`;
}

async function health(): Promise<string> {
  try {
    const r = await fetch(`${API}/api/health`);
    return JSON.stringify(await r.json());
  } catch (e) {
    return `unreachable (${(e as Error).message})`;
  }
}

const boards = creds.map(
  (c) =>
    new VirtualBoard({
      url: WS,
      keyId: c.keyId,
      secret: c.secret,
      channels: { 1: 'switch', 2: 'temperatureSensor' },
      model: 'voltix-load',
    }),
);
for (const b of boards) b.on('invalid', (e) => console.warn('invalid message', e));

async function connectTimed(b: VirtualBoard, into: number[], failures: string[]) {
  const t0 = performance.now();
  try {
    await b.connect();
    into.push(performance.now() - t0);
  } catch (e) {
    failures.push((e as Error).message);
  }
}

// ── 1. connect ────────────────────────────────────────────────────────────────
console.log(`server: ${await health()}`);
console.log(`connecting ${boards.length} boards at ${values.ramp}/s ...`);
const connectMs: number[] = [];
const connectFail: string[] = [];
const rampDelay = 1000 / Number(values.ramp);
const t0 = performance.now();
const pending: Promise<void>[] = [];
for (const b of boards) {
  pending.push(connectTimed(b, connectMs, connectFail));
  await sleep(rampDelay);
}
await Promise.all(pending);
console.log(
  `connect: ${stats(connectMs)}, failed=${connectFail.length}, wall=${((performance.now() - t0) / 1000).toFixed(1)}s`,
);
if (connectFail.length) console.log(`  first failures: ${[...new Set(connectFail)].slice(0, 3).join(' | ')}`);
console.log(`server: ${await health()}`);

// ── 2. steady state ───────────────────────────────────────────────────────────
const online = () => boards.filter((b) => b.deviceByChannel.size > 0);
const durationMs = Number(values.duration) * 1000;
const telemetryMs = Number(values.telemetry) * 1000;
let events = 0;
let presses = 0;
const timers: NodeJS.Timeout[] = [];
for (const b of online()) {
  const offset = Math.random() * telemetryMs;
  timers.push(
    setTimeout(() => {
      const send = () => {
        if (!b.deviceByChannel.size) return;
        b.event(2, 'currentTemperature', { temperature: +(20 + Math.random() * 10).toFixed(1) });
        events++;
      };
      send();
      timers.push(setInterval(send, telemetryMs));
    }, offset),
  );
}
const pressers = online().filter((_, i) => i % 10 === 0);
for (const b of pressers) {
  timers.push(
    setInterval(
      () => {
        if (!b.deviceByChannel.size) return;
        b.pressSwitch(1);
        presses++;
      },
      60_000 + Math.random() * 5000,
    ),
  );
}

const commandMs: number[] = [];
const commandErr = new Map<string, number>();
async function command() {
  const list = online();
  const b = list[Math.floor(Math.random() * list.length)];
  const deviceId = b?.deviceByChannel.get(1);
  if (!deviceId) return;
  const t = performance.now();
  try {
    const r = await fetch(`${API}/api/v1/devices/${deviceId}/actions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fleet.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'setPowerState', value: { state: Math.random() < 0.5 ? 'On' : 'Off' } }),
    });
    if (r.ok) commandMs.push(performance.now() - t);
    else {
      const code = ((await r.json()) as { error?: { code?: string } }).error?.code ?? String(r.status);
      commandErr.set(code, (commandErr.get(code) ?? 0) + 1);
    }
  } catch (e) {
    commandErr.set((e as Error).message, (commandErr.get((e as Error).message) ?? 0) + 1);
  }
}
console.log(`steady state for ${values.duration}s ...`);
const commandEvery = 1000 / Number(values.commands);
const steadyEnd = performance.now() + durationMs;
const inflight: Promise<void>[] = [];
while (performance.now() < steadyEnd) {
  inflight.push(command());
  await sleep(commandEvery);
}
await Promise.all(inflight);
for (const t of timers) clearTimeout(t);
console.log(
  `steady: telemetry events=${events} (${(events / (durationMs / 1000)).toFixed(0)}/s), switch presses=${presses}`,
);
console.log(`commands: ${stats(commandMs)}, errors=${JSON.stringify(Object.fromEntries(commandErr))}`);
console.log(`server: ${await health()}`);

// ── 3. reconnect storm ────────────────────────────────────────────────────────
if (values.storm) {
  console.log('storm: cutting every socket ...');
  for (const b of boards) b.kill();
  await sleep(1000);
  const stormMs: number[] = [];
  const stormFail: string[] = [];
  const s0 = performance.now();
  await Promise.all(
    boards.map(async (b) => {
      await sleep(1000 + Math.random() * 9000);
      await connectTimed(b, stormMs, stormFail);
    }),
  );
  console.log(
    `storm: all back in ${((performance.now() - s0) / 1000).toFixed(1)}s; handshake ${stats(stormMs)}, failed=${stormFail.length}`,
  );
  console.log(`server: ${await health()}`);
}

await Promise.all(boards.map((b) => b.close()));
process.exit(0);
