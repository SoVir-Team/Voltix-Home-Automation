import {
  COMMAND_TIMEOUT_MS,
  controllerActions,
  decodeMessage,
  encodeMessage,
  handshakeSignature,
  newPayload,
  OFFLINE_GRACE_MS,
  type Payload,
  PING_INTERVAL_MS,
  parseChannelsHeader,
  REPLAY_WINDOW_S,
  safeEqual,
} from '@voltix/protocol/node';
import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import type { AppContext } from '../../context';
import { controllers } from '../../db/schema';
import { decryptSecret } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export interface ControllerAuth {
  controllerId: string;
  homeId: string;
  keyId: string;
  secret: string;
}

export interface HandshakeMeta {
  channels: { channel: number; type: string }[];
  model: string | null;
  version: string | null;
  mac: string | null;
  ip: string;
  restoreStates: boolean;
}

export interface GatewayHooks {
  /** Board connected and authenticated: sync devices, send config, restore states, OTA offers. */
  onConnected(auth: ControllerAuth, meta: HandshakeMeta): Promise<void>;
  /** Board confirmed offline after the grace period. */
  onOffline(auth: ControllerAuth): Promise<void>;
  /** Signed event from the board (device state change, sensor reading, OTA status...). */
  onEvent(auth: ControllerAuth, payload: Payload): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  auth: ControllerAuth;
  alive: boolean;
  badMessages: number;
  /** replyTokens seen within the replay window (token -> expiry ms). */
  seen: Map<string, number>;
}

interface Pending {
  controllerId: string;
  resolve: (p: Payload) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export const deviceOffline = () => new AppError(409, 'DEVICE_OFFLINE', 'The device is offline');
export const deviceTimeout = () => new AppError(504, 'DEVICE_TIMEOUT', 'The device did not respond in time');

/** Owns every device WebSocket: authentication, signing, request/response matching, liveness. */
export class Gateway {
  private readonly conns = new Map<string, Conn>();
  private readonly pending = new Map<string, Pending>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly authCache = new Map<string, ControllerAuth>();
  private readonly pingTimer: NodeJS.Timeout;
  hooks!: GatewayHooks;

  constructor(
    private readonly ctx: AppContext,
    private readonly offlineGraceMs = OFFLINE_GRACE_MS,
  ) {
    this.pingTimer = setInterval(() => this.heartbeat(), PING_INTERVAL_MS).unref();
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  isOnline(controllerId: string): boolean {
    return this.conns.has(controllerId);
  }

  /** Verify handshake headers. Throws 401 so the HTTP upgrade is refused before a socket exists. */
  async authenticate(
    headers: Record<string, string | string[] | undefined>,
    ip: string,
  ): Promise<{ auth: ControllerAuth; meta: HandshakeMeta }> {
    const h = (name: string) => {
      const v = headers[name];
      return typeof v === 'string' ? v : undefined;
    };
    const keyId = h('x-voltix-key');
    const ts = Number(h('x-voltix-ts'));
    const sig = h('x-voltix-sig');
    const fail = (why: string) => {
      this.ctx.log.warn({ keyId, ip, why }, 'device handshake rejected');
      return new AppError(401, 'DEVICE_AUTH_FAILED', 'Device authentication failed');
    };
    if (!keyId || !sig || !Number.isFinite(ts)) throw fail('missing headers');
    if (Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_S) throw fail('clock skew');
    const auth = await this.loadAuth(keyId);
    if (!auth) throw fail('unknown key');
    if (!safeEqual(sig, handshakeSignature(auth.secret, keyId, ts))) throw fail('bad signature');
    let channels: HandshakeMeta['channels'];
    try {
      channels = parseChannelsHeader(h('x-voltix-channels'));
    } catch {
      throw new AppError(400, 'BAD_CHANNELS', 'Invalid x-voltix-channels header');
    }
    return {
      auth,
      meta: {
        channels,
        model: h('x-voltix-model')?.slice(0, 40) ?? null,
        version: h('x-voltix-version')?.slice(0, 40) ?? null,
        mac: h('x-voltix-mac')?.slice(0, 32) ?? null,
        ip,
        restoreStates: h('x-voltix-restore') === 'true',
      },
    };
  }

  private async loadAuth(keyId: string): Promise<ControllerAuth | undefined> {
    const cached = this.authCache.get(keyId);
    if (cached) return cached;
    const [row] = await this.ctx.db
      .select({ id: controllers.id, homeId: controllers.homeId, secretEnc: controllers.secretEnc })
      .from(controllers)
      .where(eq(controllers.keyId, keyId))
      .limit(1);
    if (!row) return undefined;
    const auth = {
      controllerId: row.id,
      homeId: row.homeId,
      keyId,
      secret: decryptSecret(row.secretEnc, this.ctx.encKey),
    };
    if (this.authCache.size > 10_000) this.authCache.clear();
    this.authCache.set(keyId, auth);
    return auth;
  }

  /** Forget cached credentials (secret regenerated / controller deleted) and drop the live socket. */
  invalidate(keyId: string, controllerId: string, reason: string): void {
    this.authCache.delete(keyId);
    this.disconnect(controllerId, reason);
  }

  disconnect(controllerId: string, reason: string): void {
    this.conns.get(controllerId)?.ws.close(4002, reason.slice(0, 100));
  }

  attach(ws: WebSocket, auth: ControllerAuth, meta: HandshakeMeta): void {
    const previous = this.conns.get(auth.controllerId);
    if (previous) {
      this.conns.delete(auth.controllerId);
      previous.ws.close(4001, 'replaced by a newer connection');
    }
    const conn: Conn = { ws, auth, alive: true, badMessages: 0, seen: new Map() };
    this.conns.set(auth.controllerId, conn);
    const offline = this.offlineTimers.get(auth.controllerId);
    if (offline) {
      clearTimeout(offline);
      this.offlineTimers.delete(auth.controllerId);
    }

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return this.strike(conn, 'binary frame');
      void this.onMessage(conn, data.toString()).catch((err) =>
        this.ctx.log.error({ err, controllerId: auth.controllerId }, 'device message handling failed'),
      );
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (err) =>
      this.ctx.log.warn({ err, controllerId: auth.controllerId }, 'device socket error'),
    );

    // Clock sync first (unsigned, like Sinric), then let the device module sync config/state.
    ws.send(JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) }));
    void this.hooks
      .onConnected(auth, meta)
      .catch((err) => this.ctx.log.error({ err, controllerId: auth.controllerId }, 'onConnected failed'));
  }

  /** Send a signed request to a device and wait for its response. */
  request(
    controllerId: string,
    p: { deviceId: string; action: string; value: Record<string, unknown>; clientId: string },
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<Payload> {
    const conn = this.conns.get(controllerId);
    if (!conn) return Promise.reject(deviceOffline());
    const payload = newPayload({ ...p, type: 'request' });
    return new Promise<Payload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(payload.replyToken);
        reject(deviceTimeout());
      }, timeoutMs);
      this.pending.set(payload.replyToken, { controllerId, resolve, reject, timer });
      conn.ws.send(encodeMessage(payload, conn.auth.secret), (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(payload.replyToken);
        reject(deviceOffline());
      });
    });
  }

  /** Fire-and-forget signed request (config push, OTA offer). Returns false if offline. */
  send(
    controllerId: string,
    p: { deviceId: string; action: string; value: Record<string, unknown>; clientId?: string },
  ): boolean {
    const conn = this.conns.get(controllerId);
    if (!conn) return false;
    conn.ws.send(encodeMessage(newPayload({ clientId: 'system', ...p, type: 'request' }), conn.auth.secret));
    return true;
  }

  private async onMessage(conn: Conn, text: string): Promise<void> {
    const result = decodeMessage(text, conn.auth.secret);
    if (!result.ok) return this.strike(conn, result.error);
    const { payload } = result.envelope;

    // Replay protection inside the window: each replyToken+type is accepted once.
    const now = Date.now();
    const seenKey = `${payload.type}:${payload.replyToken}`;
    if (conn.seen.has(seenKey)) return this.strike(conn, 'replayed message');
    conn.seen.set(seenKey, now + REPLAY_WINDOW_S * 2000);
    if (conn.seen.size > 512) for (const [k, exp] of conn.seen) if (exp < now) conn.seen.delete(k);

    if (payload.type === 'response') {
      const pending = this.pending.get(payload.replyToken);
      if (!pending || pending.controllerId !== conn.auth.controllerId) return; // late or foreign: ignore
      clearTimeout(pending.timer);
      this.pending.delete(payload.replyToken);
      pending.resolve(payload);
      return;
    }
    if (payload.type === 'event') {
      await this.hooks.onEvent(conn.auth, payload);
      return;
    }
    this.strike(conn, 'unexpected request from device');
  }

  /** Count protocol violations; a misbehaving board is disconnected. */
  private strike(conn: Conn, why: string): void {
    conn.badMessages++;
    this.ctx.log.warn({ controllerId: conn.auth.controllerId, why }, 'rejected device message');
    if (conn.badMessages >= 10) conn.ws.close(4003, 'too many invalid messages');
  }

  private onClose(conn: Conn): void {
    if (this.conns.get(conn.auth.controllerId) !== conn) return; // replaced
    this.conns.delete(conn.auth.controllerId);
    for (const [token, p] of this.pending) {
      if (p.controllerId !== conn.auth.controllerId) continue;
      clearTimeout(p.timer);
      this.pending.delete(token);
      p.reject(deviceOffline());
    }
    const timer = setTimeout(() => {
      this.offlineTimers.delete(conn.auth.controllerId);
      if (this.conns.has(conn.auth.controllerId)) return;
      void this.hooks.onOffline(conn.auth).catch((err) => this.ctx.log.error({ err }, 'onOffline failed'));
    }, this.offlineGraceMs);
    timer.unref();
    this.offlineTimers.set(conn.auth.controllerId, timer);
  }

  private heartbeat(): void {
    for (const conn of this.conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  /** Graceful shutdown: close sockets so boards reconnect to the next process quickly. */
  close(): void {
    clearInterval(this.pingTimer);
    for (const t of this.offlineTimers.values()) clearTimeout(t);
    for (const conn of this.conns.values()) conn.ws.close(1012, 'server restarting');
    this.conns.clear();
  }
}

export { controllerActions };
