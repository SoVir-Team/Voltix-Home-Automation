/**
 * A virtual Voltix board speaking the real device protocol (signed WSS). Behaves like the ESP32 firmware:
 * announces channels, applies config, answers commands, reports physical switch presses and sensors.
 */
import { EventEmitter } from 'node:events';
import {
  type ConfigValue,
  controllerActions,
  decodeMessage,
  encodeMessage,
  handshakeSignature,
  newPayload,
  type Payload,
} from '@voltix/protocol/node';
import WebSocket from 'ws';

export interface BoardOptions {
  /** e.g. ws://localhost:4000/api/v1/device */
  url: string;
  keyId: string;
  secret: string;
  /** channel -> device type, e.g. { 1: 'switch', 5: 'fan' } */
  channels: Record<number, string>;
  model?: string;
  version?: string;
  restoreStates?: boolean;
  /** Reject commands (simulates a faulty relay). */
  failActions?: boolean;
  /** Don't answer commands (simulates a hung board). */
  silent?: boolean;
  /** Pretend the OTA download/installation works and reconnect with the new version. */
  autoOta?: boolean;
}

export class VirtualBoard extends EventEmitter {
  ws?: WebSocket;
  version: string;
  /** deviceId -> channel (from the server's config message). */
  readonly deviceByChannel = new Map<number, string>();
  readonly state = new Map<number, Record<string, unknown>>();
  readonly received: Payload[] = [];
  private closing = false;

  constructor(readonly opts: BoardOptions) {
    super();
    this.version = opts.version ?? '1.0.0';
    for (const ch of Object.keys(opts.channels)) this.state.set(Number(ch), { powerState: 'Off' });
  }

  /** Connect and resolve once the server has sent the channel config. */
  connect(): Promise<void> {
    this.closing = false;
    const ts = Math.floor(Date.now() / 1000);
    const ws = new WebSocket(this.opts.url, {
      headers: {
        'x-voltix-key': this.opts.keyId,
        'x-voltix-ts': String(ts),
        'x-voltix-sig': handshakeSignature(this.opts.secret, this.opts.keyId, ts),
        'x-voltix-channels': Object.entries(this.opts.channels)
          .map(([c, t]) => `${c}:${t}`)
          .join(','),
        'x-voltix-model': this.opts.model ?? 'voltix-esp32',
        'x-voltix-version': this.version,
        'x-voltix-mac': 'AA:BB:CC:00:00:01',
        'x-voltix-restore': String(!!this.opts.restoreStates),
      },
    });
    this.ws = ws;
    return new Promise((resolve, reject) => {
      const onConfig = () => {
        cleanup();
        resolve();
      };
      const onFail = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.off('config', onConfig);
        ws.off('error', onFail);
        ws.off('unexpected-response', onUnexpected);
      };
      const onUnexpected = (_req: unknown, res: { statusCode?: number }) =>
        onFail(new Error(`handshake rejected: HTTP ${res.statusCode}`));
      this.once('config', onConfig);
      ws.once('error', onFail);
      ws.once('unexpected-response', onUnexpected);
      // Errors after the handshake (or from kill() mid-connect) end in 'close'; never let them crash the process.
      ws.on('error', () => {});
      ws.on('message', (data) => this.onMessage(data.toString()));
      ws.on('close', (code, reason) => this.emit('close', code, reason.toString()));
    });
  }

  close(): Promise<void> {
    this.closing = true;
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) return resolve();
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  /** Abrupt disconnect (power cut). */
  kill(): void {
    this.ws?.terminate();
  }

  private send(p: Payload): void {
    // A message can arrive on the old socket while a reconnect is under way; drop the reply, as a board would.
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(encodeMessage(p, this.opts.secret));
  }

  private onMessage(text: string): void {
    const parsed = JSON.parse(text) as { timestamp?: number };
    if (parsed.timestamp && !('payload' in parsed)) return void this.emit('timestamp', parsed.timestamp);
    const res = decodeMessage(text, this.opts.secret);
    if (!res.ok) return void this.emit('invalid', res.error);
    const p = res.envelope.payload;
    this.received.push(p);
    if (p.action === controllerActions.config) {
      this.deviceByChannel.clear();
      for (const c of (p.value as ConfigValue).channels) this.deviceByChannel.set(c.channel, c.deviceId);
      this.emit('config', p.value);
      return;
    }
    if (p.action === controllerActions.otaUpdateAvailable) return void this.handleOta(p);
    if (p.action === controllerActions.restart) return void this.emit('restart');
    this.handleCommand(p);
  }

  channelOf(deviceId: string): number | undefined {
    for (const [ch, id] of this.deviceByChannel) if (id === deviceId) return ch;
    return undefined;
  }

  private handleCommand(p: Payload): void {
    this.emit('command', p);
    if (this.opts.silent) return;
    const ch = this.channelOf(p.deviceId);
    if (ch === undefined || this.opts.failActions) {
      this.send(newPayload({ ...reply(p), value: {}, success: false, message: 'relay fault' }));
      return;
    }
    const s = this.state.get(ch) ?? {};
    const v = p.value as Record<string, number | string>;
    let value: Record<string, unknown> = p.value;
    if (p.action === 'setPowerState') s.powerState = v.state;
    else if (p.action === 'setPowerLevel') s.powerLevel = v.powerLevel;
    else if (p.action === 'adjustPowerLevel') {
      s.powerLevel = clamp(Number(s.powerLevel ?? 0) + Number(v.powerLevelDelta));
      value = { powerLevel: s.powerLevel };
    } else if (p.action === 'setBrightness') s.brightness = v.brightness;
    else if (p.action === 'adjustBrightness') {
      s.brightness = clamp(Number(s.brightness ?? 0) + Number(v.brightnessDelta));
      value = { brightness: s.brightness };
    }
    this.state.set(ch, s);
    this.send(newPayload({ ...reply(p), value, success: true, message: 'OK' }));
  }

  /** Simulate someone pressing the wall switch for a channel. */
  pressSwitch(channel: number): void {
    const s = this.state.get(channel) ?? {};
    s.powerState = s.powerState === 'On' ? 'Off' : 'On';
    this.state.set(channel, s);
    this.event(channel, 'setPowerState', { state: s.powerState }, { type: 'PHYSICAL_INTERACTION' });
  }

  /** Send any device event (sensor reading, doorbell, ...). */
  event(channel: number, action: string, value: Record<string, unknown>, cause?: { type: string }): void {
    const deviceId = this.deviceByChannel.get(channel);
    if (!deviceId) throw new Error(`channel ${channel} has no device yet`);
    this.send(
      newPayload({
        action,
        clientId: cause?.type === 'PHYSICAL_INTERACTION' ? 'physical' : 'device',
        deviceId,
        type: 'event',
        value,
        ...(cause && { cause }),
      }),
    );
  }

  /** Raw access for protocol tests (replays, tampering). */
  sendRaw(text: string): void {
    this.ws?.send(text);
  }

  private async handleOta(p: Payload): Promise<void> {
    const v = p.value as { url: string; version: string; sha256: string };
    this.emit('ota', v);
    if (!this.opts.autoOta) return;
    const status = (s: string, progress?: number) =>
      this.send(
        newPayload({
          action: controllerActions.otaStatus,
          clientId: 'device',
          deviceId: this.opts.keyId,
          type: 'event',
          value: { version: v.version, status: s, ...(progress !== undefined && { progress }) },
        }),
      );
    status('accepted');
    const res = await fetch(v.url);
    if (!res.ok) return status('failed');
    const buf = Buffer.from(await res.arrayBuffer());
    const { createHash } = await import('node:crypto');
    if (createHash('sha256').update(buf).digest('hex') !== v.sha256) return status('failed');
    status('downloading', 100);
    status('installing', 100);
    await this.close();
    this.version = v.version;
    await this.connect();
  }

  get isClosing(): boolean {
    return this.closing;
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const reply = (p: Payload) => ({
  action: p.action,
  clientId: p.clientId,
  deviceId: p.deviceId,
  replyToken: p.replyToken,
  type: 'response' as const,
});
