import jwt from 'jsonwebtoken';
import request from 'supertest';
import { roleSatisfies } from '@libraverse/shared';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runAsSystem } from '../src/core/tenant';
import { issuePasswordSetupLink } from '../src/modules/auth/service';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/modules/auth/tokens';
import { SessionModel } from '../src/modules/auth/sessionModel';
import {
  PASSWORD,
  cookieNames,
  createLibrary,
  createUser,
  lastCodeSentTo,
  signedInAgent,
} from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (!cookie) throw new Error('no refresh cookie');
  return cookie.split(';')[0]!;
}

describe('login', () => {
  it('signs in, sets httpOnly cookies, and /me returns the user', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'librarian', email: 'staff@city.test' });

    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ email: 'STAFF@city.test', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      user: {
        email: 'staff@city.test',
        role: 'librarian',
        libraryId: id,
        libraryName: 'Library city',
      },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    const raw = res.headers['set-cookie'] as unknown as string[];
    expect(raw.every((c) => /HttpOnly/i.test(c))).toBe(true);
    expect(cookieNames(res)).toEqual(expect.arrayContaining([ACCESS_COOKIE, REFRESH_COOKIE]));

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('staff@city.test');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'member', email: 'reader@city.test' });
    const wrong = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reader@city.test', password: 'nope-nope1' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@city.test', password: 'nope-nope1' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects invited and disabled accounts', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'member', email: 'inv@city.test', status: 'invited' });
    await createUser({ libraryId: id, role: 'member', email: 'off@city.test', status: 'disabled' });
    for (const email of ['inv@city.test', 'off@city.test']) {
      const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
      expect(res.status).toBe(401);
    }
  });

  it.each(['pending', 'suspended', 'rejected'] as const)(
    'blocks users of a %s library',
    async (status) => {
      const { id } = await createLibrary('city', status);
      await createUser({ libraryId: id, role: 'libraryAdmin', email: 'owner@city.test' });
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'owner@city.test', password: PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        code: 'LIBRARY_NOT_ACTIVE',
        details: { libraryStatus: status },
      });
    },
  );

  it('asks which library when one email has accounts in two, then signs into the chosen one', async () => {
    const a = await createLibrary('college');
    const b = await createLibrary('city');
    await createUser({ libraryId: a.id, role: 'member', email: 'sam@x.test' });
    await createUser({ libraryId: b.id, role: 'librarian', email: 'sam@x.test' });

    const ask = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@x.test', password: PASSWORD });
    expect(ask.status).toBe(409);
    expect(ask.body.error.code).toBe('LIBRARY_CHOICE_REQUIRED');
    expect(ask.body.error.details).toEqual(
      expect.arrayContaining([
        { libraryId: a.id, libraryName: 'Library college', role: 'member' },
        { libraryId: b.id, libraryName: 'Library city', role: 'librarian' },
      ]),
    );

    const chosen = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@x.test', password: PASSWORD, libraryId: b.id });
    expect(chosen.status).toBe(200);
    expect(chosen.body.user).toMatchObject({ role: 'librarian', libraryId: b.id });
  });

  it('does not offer a library whose account has a different password', async () => {
    const a = await createLibrary('college');
    const b = await createLibrary('city');
    await createUser({ libraryId: a.id, role: 'member', email: 'sam@x.test' });
    await createUser({
      libraryId: b.id,
      role: 'member',
      email: 'sam@x.test',
      password: 'Other-pass9',
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@x.test', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.libraryId).toBe(a.id);
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('two-factor sign-in for staff', () => {
  async function start() {
    const { id } = await createLibrary('city');
    await createUser({
      libraryId: id,
      role: 'libraryAdmin',
      email: 'owner@city.test',
      twoFactorEnabled: true,
    });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@city.test', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('twoFactorRequired');
    expect(cookieNames(res)).toEqual([]);
    return res.body.challengeToken as string;
  }

  it('emails a code and signs in only with it', async () => {
    const challengeToken = await start();
    const code = lastCodeSentTo('owner@city.test');

    const wrongCode = code === '000000' ? '111111' : '000000';
    const bad = await request(app)
      .post('/api/auth/login/otp')
      .send({ challengeToken, code: wrongCode });
    expect(bad.status).toBe(401);

    const agent = request.agent(app);
    const ok = await agent.post('/api/auth/login/otp').send({ challengeToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('libraryAdmin');
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    const replay = await request(app).post('/api/auth/login/otp').send({ challengeToken, code });
    expect(replay.status).toBe(401);
  });

  it('locks the code after 5 wrong attempts', async () => {
    const challengeToken = await start();
    const code = lastCodeSentTo('owner@city.test');
    const wrongCode = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/auth/login/otp').send({ challengeToken, code: wrongCode });
    }
    const res = await request(app).post('/api/auth/login/otp').send({ challengeToken, code });
    expect(res.status).toBe(401);
  });

  it('members cannot turn it on; staff can', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'member', email: 'reader@city.test' });
    await createUser({ libraryId: id, role: 'librarian', email: 'staff@city.test' });

    const member = await signedInAgent(app, 'reader@city.test');
    expect((await member.put('/api/auth/two-factor').send({ enabled: true })).status).toBe(403);

    const staff = await signedInAgent(app, 'staff@city.test');
    const res = await staff.put('/api/auth/two-factor').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.user.twoFactorEnabled).toBe(true);
  });
});

describe('sessions', () => {
  beforeEach(async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'member', email: 'reader@city.test' });
  });

  it('rotates the refresh token, and reuse of an old one ends the session', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reader@city.test', password: PASSWORD });
    const first = refreshCookieFrom(login);

    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(r1.status).toBe(200);
    const second = refreshCookieFrom(r1);
    expect(second).not.toBe(first);

    const reuse = await request(app).post('/api/auth/refresh').set('Cookie', first);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_REUSED');

    // The whole family is revoked, including the newest token.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', second);
    expect(after.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const agent = await signedInAgent(app, 'reader@city.test');
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
    const sessions = await runAsSystem('test', () => SessionModel.find().lean());
    expect(sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it('reports an expired access token distinctly so the client can refresh', async () => {
    const expired = jwt.sign(
      { sub: 'x', role: 'member', lib: null, exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.JWT_ACCESS_SECRET!,
      { audience: 'access' },
    );
    const res = await request(app).get('/api/auth/me').set('Cookie', `${ACCESS_COOKIE}=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed with another secret', async () => {
    const forged = jwt.sign({ sub: 'x', role: 'superAdmin', lib: null }, 'x'.repeat(40), {
      audience: 'access',
    });
    const res = await request(app).get('/api/auth/me').set('Cookie', `${ACCESS_COOKIE}=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('password reset by OTP', () => {
  it('resets every account on the email and ends their sessions', async () => {
    const a = await createLibrary('college');
    const b = await createLibrary('city');
    await createUser({ libraryId: a.id, role: 'member', email: 'sam@x.test' });
    await createUser({
      libraryId: b.id,
      role: 'member',
      email: 'sam@x.test',
      password: 'Other-pass9',
    });
    const agent = await signedInAgent(app, 'sam@x.test', { libraryId: a.id });

    const forgot = await request(app)
      .post('/api/auth/password/forgot')
      .send({ email: 'sam@x.test' });
    expect(forgot.status).toBe(200);
    const code = lastCodeSentTo('sam@x.test');

    const reset = await request(app)
      .post('/api/auth/password/reset')
      .send({ email: 'sam@x.test', code, password: 'Brand-new-pass1' });
    expect(reset.status).toBe(200);

    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@x.test', password: PASSWORD });
    expect(old.status).toBe(401);
    const both = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sam@x.test', password: 'Brand-new-pass1' });
    expect(both.status).toBe(409); // both accounts now share the new password
  });

  it('answers the same for unknown emails and sends nothing', async () => {
    const res = await request(app)
      .post('/api/auth/password/forgot')
      .send({ email: 'ghost@x.test' });
    expect(res.status).toBe(200);
    expect(testOutbox).toHaveLength(0);
  });

  it('rejects a wrong code and a weak password', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'member', email: 'reader@city.test' });
    await request(app).post('/api/auth/password/forgot').send({ email: 'reader@city.test' });
    const code = lastCodeSentTo('reader@city.test');

    const weak = await request(app)
      .post('/api/auth/password/reset')
      .send({ email: 'reader@city.test', code, password: 'short' });
    expect(weak.status).toBe(400);

    const wrong = await request(app)
      .post('/api/auth/password/reset')
      .send({
        email: 'reader@city.test',
        code: code === '000000' ? '111111' : '000000',
        password: 'Brand-new-pass1',
      });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('INVALID_CODE');
  });
});

describe('set-password link', () => {
  it('activates an invited account once, then the link is spent', async () => {
    const { id } = await createLibrary('city');
    const user = await createUser({
      libraryId: id,
      role: 'libraryAdmin',
      email: 'owner@city.test',
      status: 'invited',
    });
    const link = await issuePasswordSetupLink(user._id);
    const token = new URL(link).searchParams.get('token')!;

    const setup = await request(app)
      .post('/api/auth/password/setup')
      .send({ token, password: 'Owner-pass1' });
    expect(setup.status).toBe(200);
    expect(setup.body.email).toBe('owner@city.test');

    await signedInAgent(app, 'owner@city.test', { password: 'Owner-pass1' });

    const again = await request(app)
      .post('/api/auth/password/setup')
      .send({ token, password: 'Another-pass1' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_LINK');
  });
});

describe('RBAC', () => {
  it('libraryAdmin inherits librarian permissions, not the reverse', () => {
    expect(roleSatisfies('libraryAdmin', ['librarian'])).toBe(true);
    expect(roleSatisfies('librarian', ['libraryAdmin'])).toBe(false);
    expect(roleSatisfies('member', ['librarian'])).toBe(false);
    expect(roleSatisfies('superAdmin', ['librarian'])).toBe(false);
  });

  it('enforces roles on routes', async () => {
    const { id } = await createLibrary('city');
    await createUser({ libraryId: id, role: 'libraryAdmin', email: 'owner@city.test' });
    await createUser({ libraryId: id, role: 'librarian', email: 'staff@city.test' });
    await createUser({ libraryId: id, role: 'member', email: 'reader@city.test' });

    const owner = await signedInAgent(app, 'owner@city.test');
    const staff = await signedInAgent(app, 'staff@city.test');
    const member = await signedInAgent(app, 'reader@city.test');

    expect((await owner.get('/api/branches')).status).toBe(200);
    expect((await staff.get('/api/branches')).status).toBe(200);
    expect((await member.get('/api/branches')).status).toBe(403);
    for (const agent of [owner, staff, member]) {
      expect((await agent.get('/api/admin/libraries')).status).toBe(403);
    }
  });
});
