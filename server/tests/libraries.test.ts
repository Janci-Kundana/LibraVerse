import request from 'supertest';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runAsSystem, runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { verifyAuditChain } from '../src/modules/audit/service';
import { BranchModel } from '../src/modules/branches/model';
import { LibraryModel } from '../src/modules/libraries/model';
import { ensureDefaultPlans } from '../src/modules/platformPlans/service';
import { SubscriptionModel } from '../src/modules/subscriptions/model';
import { UserModel } from '../src/modules/users/model';
import { createUser, lastLinkTokenSentTo, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

const registration = {
  libraryName: 'Riverside Reading Room',
  ownerName: 'Asha Rao',
  ownerEmail: 'asha@riverside.test',
  planCode: 'free',
};

beforeEach(async () => {
  await runAsSystem('test', ensureDefaultPlans);
});

async function register(body: Record<string, unknown> = registration) {
  return request(app).post('/api/libraries/register').send(body);
}

async function superAdmin() {
  const admin = await createUser({
    libraryId: null,
    role: 'superAdmin',
    email: 'root@platform.test',
  });
  return { agent: await signedInAgent(app, 'root@platform.test'), id: String(admin._id) };
}

describe('GET /api/platform-plans', () => {
  it('lists Free and Pro publicly, cheapest first', async () => {
    const res = await request(app).get('/api/platform-plans');
    expect(res.status).toBe(200);
    expect(res.body.map((p: { code: string }) => p.code)).toEqual(['free', 'pro']);
  });
});

describe('POST /api/libraries/register (FR-01, Free plan)', () => {
  it('creates a pending library with its owner, main branch, subscription and audit entry', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: 'riverside-reading-room', status: 'pending' });
    const libraryId = res.body.id as string;

    await runWithTenant(libraryId, async () => {
      const owner = await UserModel.findOne({ email: 'asha@riverside.test' }).lean();
      expect(owner).toMatchObject({ role: 'libraryAdmin', status: 'invited' });
      expect(await BranchModel.countDocuments()).toBe(1);
      expect(await SubscriptionModel.findOne().lean()).toMatchObject({ status: 'pending' });
      const audit = await AuditLogModel.find().lean();
      expect(audit.map((a) => a.action)).toEqual(['library.registered']);
    });
    expect(testOutbox.map((m) => m.to)).toEqual(['asha@riverside.test']);
  });

  it('refuses Pro until payments exist', async () => {
    const res = await register({ ...registration, planCode: 'pro' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLAN_NOT_AVAILABLE');
    expect(await runAsSystem('test', () => LibraryModel.countDocuments())).toBe(0);
  });

  it('rejects a taken web address', async () => {
    expect((await register()).status).toBe(201);
    const again = await register({ ...registration, ownerEmail: 'other@x.test' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SLUG_TAKEN');
  });

  it('validates the body', async () => {
    const res = await register({ libraryName: 'X', planCode: 'gold' });
    expect(res.status).toBe(400);
  });
});

describe('Super Admin library workflow (FR-05)', () => {
  it('approve emails a set-password link; the owner can then sign in', async () => {
    const libraryId = (await register()).body.id as string;
    const { agent, id: adminId } = await superAdmin();

    const pending = await agent.get('/api/admin/libraries?status=pending');
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({
      id: libraryId,
      planCode: 'free',
      ownerName: 'Asha Rao',
    });

    const approve = await agent.post(`/api/admin/libraries/${libraryId}/approve`).send({});
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('active');

    const token = lastLinkTokenSentTo('asha@riverside.test');
    const setup = await request(app)
      .post('/api/auth/password/setup')
      .send({ token, password: 'Riverside-1' });
    expect(setup.status).toBe(200);

    const owner = await signedInAgent(app, 'asha@riverside.test', { password: 'Riverside-1' });
    const me = await owner.get('/api/auth/me');
    expect(me.body.user).toMatchObject({
      role: 'libraryAdmin',
      libraryName: 'Riverside Reading Room',
    });

    await runWithTenant(libraryId, async () => {
      expect(await SubscriptionModel.findOne().lean()).toMatchObject({ status: 'active' });
      const approved = await AuditLogModel.findOne({ action: 'library.approved' }).lean();
      expect(approved).toMatchObject({
        actorRole: 'superAdmin',
        details: { from: 'pending', to: 'active' },
      });
      expect(String(approved!.actorId)).toBe(adminId);
    });
    expect(await verifyAuditChain(libraryId)).toBeNull();
  });

  it('reject keeps the library inactive and emails the reason', async () => {
    const libraryId = (await register()).body.id as string;
    const { agent } = await superAdmin();

    const res = await agent
      .post(`/api/admin/libraries/${libraryId}/reject`)
      .send({ reason: 'Could not verify the library' });
    expect(res.body.status).toBe('rejected');
    expect(testOutbox.at(-1)?.text).toContain('Could not verify the library');

    const approve = await agent.post(`/api/admin/libraries/${libraryId}/approve`).send({});
    expect(approve.status).toBe(409);
    expect(approve.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('suspend blocks sign-in; reactivate restores it', async () => {
    const libraryId = (await register()).body.id as string;
    const { agent } = await superAdmin();
    await agent.post(`/api/admin/libraries/${libraryId}/approve`).send({});
    await request(app)
      .post('/api/auth/password/setup')
      .send({ token: lastLinkTokenSentTo('asha@riverside.test'), password: 'Riverside-1' });

    const owner = await signedInAgent(app, 'asha@riverside.test', { password: 'Riverside-1' });
    expect(
      (await agent.post(`/api/admin/libraries/${libraryId}/suspend`).send({})).body.status,
    ).toBe('suspended');

    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@riverside.test', password: 'Riverside-1' });
    expect(blocked.status).toBe(403);
    // An existing session cannot be refreshed either.
    expect((await owner.post('/api/auth/refresh')).status).toBe(403);

    await agent.post(`/api/admin/libraries/${libraryId}/reactivate`).send({});
    await signedInAgent(app, 'asha@riverside.test', { password: 'Riverside-1' });

    const actions = await runWithTenant(libraryId, () =>
      AuditLogModel.find().sort({ seq: 1 }).distinct('action'),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'library.registered',
        'library.approved',
        'library.suspended',
        'library.reactivated',
      ]),
    );
  });

  it('only allows valid transitions and known libraries', async () => {
    const libraryId = (await register()).body.id as string;
    const { agent } = await superAdmin();
    expect((await agent.post(`/api/admin/libraries/${libraryId}/suspend`).send({})).status).toBe(
      409,
    );
    expect((await agent.post(`/api/admin/libraries/${libraryId}/reactivate`).send({})).status).toBe(
      409,
    );
    expect(
      (await agent.post('/api/admin/libraries/000000000000000000000000/approve').send({})).status,
    ).toBe(404);
    expect((await agent.post('/api/admin/libraries/not-an-id/approve').send({})).status).toBe(404);
  });

  it('the library list exposes library-level facts only', async () => {
    await register();
    const { agent } = await superAdmin();
    const res = await agent.get('/api/admin/libraries');
    expect(Object.keys(res.body[0]).sort()).toEqual(
      [
        'contactEmail',
        'createdAt',
        'id',
        'name',
        'ownerName',
        'planCode',
        'slug',
        'status',
        'statusReason',
      ].sort(),
    );
  });
});
