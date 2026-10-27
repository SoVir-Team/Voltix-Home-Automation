#!/usr/bin/env -S npx tsx
/**
 * Run one virtual board against a Voltix server.
 *   npx tsx tools/device-sim/src/cli.ts --key vxc_... --secret ... [--url ws://localhost:4000/api/v1/device]
 *        [--channels 1:switch,2:switch,3:switch,4:switch,5:fan,6:fan] [--sensor]
 * Type a channel number + Enter to simulate pressing its wall switch.
 */
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { VirtualBoard } from './board';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:4000/api/v1/device' },
    key: { type: 'string' },
    secret: { type: 'string' },
    channels: { type: 'string', default: '1:switch,2:switch,3:switch,4:switch,5:fan,6:fan' },
    sensor: { type: 'boolean', default: false },
  },
});
if (!values.key || !values.secret) {
  console.error(
    'Usage: device-sim --key <vxc_...> --secret <secret> [--url ...] [--channels 1:switch,5:fan] [--sensor]',
  );
  process.exit(1);
}

let channelSpec = values.channels!;
if (values.sensor) channelSpec += ',7:temperatureSensor';
const channels = Object.fromEntries(
  channelSpec.split(',').map((p) => {
    const [c, t] = p.split(':');
    return [Number(c), t!];
  }),
);

const board = new VirtualBoard({ url: values.url!, keyId: values.key, secret: values.secret, channels });
board.on('command', (p) =>
  console.log(`<- ${p.action} ${JSON.stringify(p.value)} (device ${p.deviceId.slice(0, 8)})`),
);
board.on('close', (code: number, reason: string) => {
  console.log(`connection closed (${code} ${reason}); reconnecting in 3 s`);
  if (!board.isClosing) setTimeout(() => void connect(), 3000);
});

async function connect() {
  try {
    await board.connect();
    console.log(`connected; channels: ${[...board.deviceByChannel.keys()].join(', ')}`);
  } catch (err) {
    console.error((err as Error).message);
    setTimeout(() => void connect(), 3000);
  }
}
await connect();

if (values.sensor) {
  setInterval(() => {
    if (!board.deviceByChannel.has(7)) return;
    const t = 24 + Math.sin(Date.now() / 600_000) * 3 + Math.random() * 0.4;
    board.event(7, 'currentTemperature', {
      temperature: Math.round(t * 10) / 10,
      humidity: 55 + Math.round(Math.random() * 5),
    });
  }, 15_000);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const ch = Number(line.trim());
  if (board.deviceByChannel.has(ch)) {
    board.pressSwitch(ch);
    console.log(`-> wall switch ${ch} pressed (${board.state.get(ch)?.powerState})`);
  }
});
