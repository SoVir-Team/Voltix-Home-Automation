import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, resetDb, signUp, startApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.ctx));

describe('auth', () => {
  it('registers, creates a starter home and signs in with httpOnly cookies', async () => {
    const c = new Client(t);
    const res = await c.post('/auth/register', {
      name: 'Asha',
      email: 'Asha@Example.com',
      password: 'correct-horse-battery',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('asha@example.com');
    expect(c.cookies.has('vx_at')).toBe(true);
    expect(c.cookies.has('vx_rt')).toBe(true);
    const homes = await c.get('/homes');
    expect(homes.body.homes).toHaveLength(1);
    expect(homes.body.homes[0].role).toBe('owner');
    const rooms = await c.get(`/homes/${homes.body.homes[0].id}/rooms`);
    expect(rooms.body.rooms.map((r: { name: string }) => r.name)).toEqual([
      'Living Room',
      'Kitchen',
      'Bedroom',
    ]);
    expect(t.ctx.mailer.sent.at(-1)?.subject).toMatch(/Confirm your Voltix email/);
  });

  it('rejects weak/common passwords and duplicate emails', async () => {
    const c = new Client(t);
    expect((await c.post('/auth/register', { name: 'A', email: 'a@x.io', password: 'short' })).status).toBe(
      400,
    );
    expect(
      (await c.post('/auth/register', { name: 'A', email: 'a@x.io', password: 'password123' })).status,
    ).toBe(400);
    expect(
      (await c.post('/auth/register', { name: 'A', email: 'a@x.io', password: 'correct-horse-battery' }))
        .status,
    ).toBe(201);
    const dup = await new Client(t).post('/auth/register', {
      name: 'B',
      email: 'A@x.io',
      password: 'correct-horse-battery',
    });
    expect(dup.status).toBe(409);
  });

  it('login: wrong password is 401 with a generic message; too many failures are throttled', async () => {
    const { email } = await signUp(t);
    const c = new Client(t);
    const bad = await c.post('/auth/login', { email, password: 'wrong-password!' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toBe('Incorrect email or password');
    const unknown = await c.post('/auth/login', { email: 'nobody@example.com', password: 'wrong-password!' });
    expect(unknown.body.error.message).toBe('Incorrect email or password');
    for (let i = 0; i < 4; i++) await c.post('/auth/login', { email, password: 'wrong-password!' });
    const locked = await c.post('/auth/login', { email, password: 'correct-horse-battery' });
    expect(locked.status).toBe(429);
  });

  it('rotates refresh tokens and revokes the whole family on reuse', async () => {
    const { client } = await signUp(t);
    const first = client.cookies.get('vx_rt')!;
    expect((await client.post('/auth/refresh')).status).toBe(200);
    const second = client.cookies.get('vx_rt')!;
    expect(second).not.toBe(first);

    // An attacker replays the old token: rejected, and the legitimate session dies too.
    const attacker = new Client(t);
    attacker.cookies.set('vx_rt', first);
    expect((await attacker.post('/auth/refresh')).status).toBe(401);
    expect((await client.post('/auth/refresh')).status).toBe(401);
  });

  it('blocks cookie-authenticated cross-site writes (CSRF) but allows same-origin', async () => {
    const { client, homeId } = await signUp(t);
    const evil = await client.req(
      'POST',
      `/homes/${homeId}/rooms`,
      { name: 'Hacked' },
      { origin: 'https://evil.example' },
    );
    expect(evil.status).toBe(403);
    const ok = await client.post(`/homes/${homeId}/rooms`, { name: 'Study' });
    expect(ok.status).toBe(201);
  });

  it('password reset: single-use link, revokes sessions', async () => {
    const { client, email } = await signUp(t);
    const anon = new Client(t);
    expect((await anon.post('/auth/forgot-password', { email })).status).toBe(202);
    expect((await anon.post('/auth/forgot-password', { email: 'ghost@example.com' })).status).toBe(202);
    const mail = t.ctx.mailer.sent.find((m) => m.to === email && /Reset/.test(m.subject))!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    expect(
      (await anon.post('/auth/reset-password', { token, password: 'a-brand-new-password' })).status,
    ).toBe(200);
    expect(
      (await anon.post('/auth/reset-password', { token, password: 'another-new-password' })).status,
    ).toBe(400);
    expect((await client.post('/auth/refresh')).status).toBe(401);
    expect((await anon.post('/auth/login', { email, password: 'a-brand-new-password' })).status).toBe(200);
  });

  it('logout clears the session', async () => {
    const { client } = await signUp(t);
    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/me')).status).toBe(401);
  });
});
