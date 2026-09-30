import { isDemoAddress } from '../src/core/mailer';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { createApp } from '../src/app';
import { attachRealtime, closeRealtime } from '../src/realtime/io';
import { createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

describe('socket handshake for cross-origin deployments', () => {
  it('accepts a short-lived socket token and rejects a forged one', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'member', email: 'reader@city.test' });
    const agent = await signedInAgent(app, 'reader@city.test');
    const { token } = (await agent.get('/api/auth/socket-token')).body;
    expect(typeof token).toBe('string');

    const server = http.createServer(app);
    attachRealtime(server);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tryConnect = (t: string) =>
      new Promise<boolean>((resolve) => {
        const s = connect(url, { auth: { token: t }, transports: ['websocket'], forceNew: true });
        s.on('connect', () => (s.close(), resolve(true)));
        s.on('connect_error', () => (s.close(), resolve(false)));
      });
    try {
      expect(await tryConnect(token)).toBe(true);
      const forged = jwt.sign({ sub: 'x', role: 'superAdmin', lib: null }, 'x'.repeat(40), {
        audience: 'socket',
      });
      expect(await tryConnect(forged)).toBe(false);
      // An access token is not accepted as a socket token (different audience).
      const access = jwt.sign(
        { sub: 'x', role: 'member', lib: lib.id },
        process.env.JWT_ACCESS_SECRET!,
        { audience: 'access' },
      );
      expect(await tryConnect(access)).toBe(false);
    } finally {
      closeRealtime();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('error responses', () => {
  it('never leak stack traces or internals', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|node_modules/);
  });
});

describe('demo mail addresses', () => {
  it('recognises reserved and seeded demo domains only', () => {
    for (const a of ['member@riverside.demo', 'x@city.test', 'k@example.com', 'a@b.invalid'])
      expect(isDemoAddress(a)).toBe(true);
    for (const a of ['someone@gmail.com', 'owner@library.in', 'x@demo.com', 'y@testing.org'])
      expect(isDemoAddress(a)).toBe(false);
  });
});
