import request from 'supertest';
import { createApp } from '../src/app';
import { runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import {
  FAKE_PNG_DATA_URL,
  PNG_DATA_URL,
  createLibrary,
  createUser,
  lastLinkTokenSentTo,
  signedInAgent,
} from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

async function setup(plan: 'free' | 'pro' = 'free') {
  const lib = await createLibrary('city', 'active', { plan });
  await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  return {
    lib,
    admin: await signedInAgent(app, 'owner@city.test'),
    librarian: await signedInAgent(app, 'staff@city.test'),
  };
}

const auditActions = (libraryId: string) =>
  runWithTenant(libraryId, () => AuditLogModel.find().sort({ seq: 1 }).distinct('action'));

describe('library settings and branding (FR-08)', () => {
  it('admin updates name, card colours and logo; the logo is publicly served', async () => {
    const { admin } = await setup();
    const res = await admin.put('/api/library/settings').send({
      name: 'City Central Library',
      cardColours: ['#c0263a', '#111827'],
      logo: PNG_DATA_URL,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'City Central Library',
      cardColours: ['#c0263a', '#111827'],
      planCode: 'free',
      branchLimit: 1,
    });
    expect(res.body.logoUrl).toMatch(/^\/api\/files\/public\/logos\//);

    const logo = await request(app).get(res.body.logoUrl);
    expect(logo.status).toBe(200);
    expect(logo.headers['content-type']).toBe('image/png');
  });

  it('rejects a file whose bytes are not an image, and bad colours', async () => {
    const { admin } = await setup();
    expect(
      (await admin.put('/api/library/settings').send({ logo: FAKE_PNG_DATA_URL })).status,
    ).toBe(400);
    expect((await admin.put('/api/library/settings').send({ cardColours: ['red'] })).status).toBe(
      400,
    );
  });

  it('librarians can read settings but not change them', async () => {
    const { librarian } = await setup();
    expect((await librarian.get('/api/library/settings')).status).toBe(200);
    expect((await librarian.put('/api/library/settings').send({ name: 'Mine now' })).status).toBe(
      403,
    );
  });

  it('the public directory lists active libraries only', async () => {
    await createLibrary('city');
    await createLibrary('town', 'pending');
    const res = await request(app).get('/api/public/libraries?q=cit');
    expect(res.body).toEqual([{ name: 'Library city', slug: 'city', logoUrl: null }]);
    expect((await request(app).get('/api/public/libraries/town')).status).toBe(404);
  });
});

describe('branches (FR-08)', () => {
  it('enforces the plan branch limit', async () => {
    const { admin } = await setup('free');
    const res = await admin.post('/api/branches').send({ name: 'North' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT');
  });

  it('creates, renames and deletes branches on Pro, keeping at least one', async () => {
    const { admin, lib } = await setup('pro');
    const created = await admin.post('/api/branches').send({ name: 'North', address: '1 Main Rd' });
    expect(created.status).toBe(201);
    expect((await admin.post('/api/branches').send({ name: 'North' })).status).toBe(409);

    const renamed = await admin
      .put(`/api/branches/${created.body.id}`)
      .send({ name: 'North Wing' });
    expect(renamed.body.name).toBe('North Wing');

    expect((await admin.delete(`/api/branches/${created.body.id}`)).status).toBe(204);
    const last = await admin.delete(`/api/branches/${lib.branch._id}`);
    expect(last.status).toBe(409);
    expect(await auditActions(lib.id)).toEqual(
      expect.arrayContaining(['branch.created', 'branch.deleted']),
    );
  });

  it('librarians cannot manage branches', async () => {
    const { librarian } = await setup('pro');
    expect((await librarian.post('/api/branches').send({ name: 'X' })).status).toBe(403);
  });
});

describe('staff management (FR-09)', () => {
  it('adds a librarian who sets a password and signs in; removal ends access', async () => {
    const { admin, lib } = await setup();
    const add = await admin.post('/api/staff').send({ name: 'Ravi', email: 'ravi@city.test' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ role: 'librarian', status: 'invited' });

    await request(app)
      .post('/api/auth/password/setup')
      .send({ token: lastLinkTokenSentTo('ravi@city.test'), password: 'Ravi-pass1' });
    const ravi = await signedInAgent(app, 'ravi@city.test', { password: 'Ravi-pass1' });

    expect((await admin.delete(`/api/staff/${add.body.id}`)).status).toBe(204);
    expect((await ravi.post('/api/auth/refresh')).status).toBe(401);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ravi@city.test', password: 'Ravi-pass1' });
    expect(login.status).toBe(401);

    expect(await auditActions(lib.id)).toEqual(
      expect.arrayContaining(['staff.added', 'staff.removed']),
    );
  });

  it('refuses duplicates, removing admins, and non-admin callers', async () => {
    const { admin, librarian } = await setup();
    expect(
      (await admin.post('/api/staff').send({ name: 'Dup', email: 'staff@city.test' })).status,
    ).toBe(409);
    const list = await admin.get('/api/staff');
    const owner = list.body.find((s: { role: string }) => s.role === 'libraryAdmin');
    expect((await admin.delete(`/api/staff/${owner.id}`)).status).toBe(409);
    expect((await librarian.get('/api/staff')).status).toBe(403);
  });
});

describe('membership plans and coupons (FR-10)', () => {
  const plan = {
    name: 'Gold',
    price: 49900,
    durationDays: 90,
    bookLimit: 4,
    finePerDay: 500,
    tier: 'gold',
  };

  it('admin creates and edits plans; librarians can read them', async () => {
    const { admin, librarian, lib } = await setup();
    const created = await admin.post('/api/membership-plans').send(plan);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...plan, active: true });
    expect((await admin.post('/api/membership-plans').send(plan)).status).toBe(409);

    const edited = await admin
      .put(`/api/membership-plans/${created.body.id}`)
      .send({ ...plan, price: 59900, active: false });
    expect(edited.body).toMatchObject({ price: 59900, active: false });

    expect((await librarian.get('/api/membership-plans')).body).toHaveLength(1);
    expect((await librarian.post('/api/membership-plans').send(plan)).status).toBe(403);
    expect(await auditActions(lib.id)).toEqual(
      expect.arrayContaining(['membershipPlan.created', 'membershipPlan.updated']),
    );
  });

  it('stores money as integer paise only', async () => {
    const { admin } = await setup();
    expect((await admin.post('/api/membership-plans').send({ ...plan, price: 499.5 })).status).toBe(
      400,
    );
  });

  it('manages coupons with unique, upper-cased codes', async () => {
    const { admin } = await setup();
    const body = { code: 'welcome10', discountPercent: 10, validTill: '2030-01-01' };
    const created = await admin.post('/api/coupons').send(body);
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('WELCOME10');
    expect((await admin.post('/api/coupons').send(body)).status).toBe(409);
    expect(
      (await admin.post('/api/coupons').send({ ...body, code: 'X', discountPercent: 150 })).status,
    ).toBe(400);
    expect((await admin.delete(`/api/coupons/${created.body.id}`)).status).toBe(204);
  });
});
