import type { AddressInfo } from 'node:net';
import { VirtualBoard } from '@voltix/device-sim';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import type { AppContext } from '../src/context';

export const ORIGIN = 'http://localhost:3000';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  port: number;
  close(): Promise<void>;
}

export async function startApp(opts: { offlineGraceMs?: number } = {}): Promise<TestApp> {
  const env = loadEnv();
  const { app, ctx } = await buildApp({ env, background: false, offlineGraceMs: opts.offlineGraceMs ?? 200 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, ctx, port, close: () => app.close() };
}

export async function resetDb(ctx: AppContext): Promise<void> {
  await ctx.sql.unsafe(`TRUNCATE users, homes, controllers, devices, device_templates, firmware_releases,
    device_events, sensor_readings, sensor_rollups_hourly, audit_log RESTART IDENTITY CASCADE`);
}

/** A signed-in browser-like client (cookie jar + Origin header) built on app.inject. */
let ipSeq = 0;
export class Client {
  cookies = new Map<string, string>();
  /** Each client looks like a different visitor behind the (trusted, loopback) proxy. */
  readonly ip = `10.0.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  constructor(readonly t: TestApp) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.t.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': this.ip,
        ...(this.cookies.size && { cookie: this.cookieHeader }),
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }

  get = <T = any>(url: string) => this.req<T>('GET', url);
  post = <T = any>(url: string, body: unknown = {}) => this.req<T>('POST', url, body);
  patch = <T = any>(url: string, body: unknown) => this.req<T>('PATCH', url, body);
  put = <T = any>(url: string, body: unknown) => this.req<T>('PUT', url, body);
  del = <T = any>(url: string) => this.req<T>('DELETE', url);
}

let seq = 0;
export async function signUp(
  t: TestApp,
  name = 'Test User',
): Promise<{ client: Client; userId: string; email: string; homeId: string }> {
  const client = new Client(t);
  const email = `user${++seq}-${Date.now()}@example.com`;
  const res = await client.post('/auth/register', { name, email, password: 'correct-horse-battery' });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  const homes = await client.get('/homes');
  return { client, userId: res.body.user.id, email, homeId: homes.body.homes[0].id };
}

/** Create a board in the home and connect a virtual board with the given channels. */
export async function connectBoard(
  t: TestApp,
  client: Client,
  homeId: string,
  channels: Record<number, string> = { 1: 'switch', 2: 'switch', 5: 'fan' },
  extra: Partial<ConstructorParameters<typeof VirtualBoard>[0]> = {},
) {
  const res = await client.post(`/homes/${homeId}/controllers`, { name: 'Living room board' });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  const { keyId, secret } = res.body.credentials;
  const board = new VirtualBoard({
    url: `ws://127.0.0.1:${t.port}/api/v1/device`,
    keyId,
    secret,
    channels,
    ...extra,
  });
  await board.connect();
  return {
    board,
    controllerId: res.body.controller.id as string,
    keyId: keyId as string,
    secret: secret as string,
  };
}

/** Browser realtime socket subscribed to a home. */
export async function openRealtime(t: TestApp, client: Client, homeId: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${t.port}/api/v1/ws`, {
    headers: { origin: ORIGIN, cookie: client.cookieHeader },
  });
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise((r, j) => {
    ws.once('open', r);
    ws.once('error', j);
  });
  ws.send(JSON.stringify({ type: 'subscribe', homeId }));
  await waitFor(() => messages.some((m) => m.type === 'subscribed'));
  return { ws, messages };
}

export async function waitFor(cond: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}
