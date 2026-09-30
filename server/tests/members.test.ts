import request from 'supertest';
import { createApp } from '../src/app';
import { runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import {
  FAKE_PNG_DATA_URL,
  PDF_DATA_URL,
  PNG_DATA_URL,
  createLibrary,
  createUser,
  signedInAgent,
} from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

const joinBody = {
  librarySlug: 'city',
  name: 'Meera Nair',
  email: 'meera@x.test',
  password: 'Meera-pass1',
  phone: '+91 98765 43210',
  idProof: PNG_DATA_URL,
  photo: PNG_DATA_URL,
  acceptTerms: true,
};

async function setup() {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  return { lib, librarian: await signedInAgent(app, 'staff@city.test') };
}

async function join(body: Record<string, unknown> = joinBody) {
  const agent = request.agent(app);
  const res = await agent.post('/api/members/join').send(body);
  return { agent, res };
}

describe('member sign-up (FR-02)', () => {
  it('creates a signed-in member whose verification is pending', async () => {
    await setup();
    const { agent, res } = await join();
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'member', libraryName: 'Library city' });

    const profile = await agent.get('/api/member/profile');
    expect(profile.body).toMatchObject({ verificationStatus: 'pending', membershipNo: null });
  });

  it('blocks the member area until the ID is approved (TC-08)', async () => {
    await setup();
    const { agent } = await join();
    const plans = await agent.get('/api/member/plans');
    expect(plans.status).toBe(403);
    expect(plans.body.error).toMatchObject({
      code: 'VERIFICATION_PENDING',
      message: expect.stringMatching(/Verification pending/),
    });
  });

  it('rejects unknown or inactive libraries, duplicates, bad files and missing consent', async () => {
    await setup();
    await createLibrary('town', 'suspended');
    expect((await join({ ...joinBody, librarySlug: 'town' })).res.status).toBe(404);
    expect((await join({ ...joinBody, idProof: FAKE_PNG_DATA_URL })).res.status).toBe(400);
    expect((await join({ ...joinBody, acceptTerms: false })).res.status).toBe(400);
    expect((await join()).res.status).toBe(201);
    expect((await join()).res.status).toBe(409);
  });

  it('lets the same email join a second library as a separate account', async () => {
    await setup();
    await createLibrary('college');
    expect((await join()).res.status).toBe(201);
    expect((await join({ ...joinBody, librarySlug: 'college' })).res.status).toBe(201);
  });
});

describe('ID verification queue (FR-13)', () => {
  it('librarian sees the proof, approves, and the member gets a 16-digit membership number', async () => {
    const { librarian, lib } = await setup();
    const { agent: member } = await join();

    const queue = await librarian.get('/api/verifications');
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]).toMatchObject({
      name: 'Meera Nair',
      email: 'meera@x.test',
      status: 'pending',
    });
    const { profileId } = queue.body[0];

    const proof = await librarian.get(`/api/verifications/${profileId}/id-proof`);
    expect(proof.status).toBe(200);
    expect(proof.headers['content-type']).toBe('image/png');
    expect(proof.headers['cache-control']).toContain('no-store');

    const approved = await librarian.post(`/api/verifications/${profileId}/approve`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.membershipNo).toMatch(/^[1-9]\d{15}$/);

    expect((await member.get('/api/member/plans')).status).toBe(200);
    expect((await librarian.post(`/api/verifications/${profileId}/approve`).send({})).status).toBe(
      409,
    );

    const audit = await runWithTenant(lib.id, () =>
      AuditLogModel.findOne({ action: 'member.idApproved' }).lean(),
    );
    expect(audit).toMatchObject({
      actorRole: 'librarian',
      target: { type: 'memberProfile', id: profileId },
    });
  });

  it('reject needs a reason; the member re-uploads and returns to the queue', async () => {
    const { librarian } = await setup();
    const { agent: member } = await join();
    const [{ profileId }] = (await librarian.get('/api/verifications')).body;

    expect((await librarian.post(`/api/verifications/${profileId}/reject`).send({})).status).toBe(
      400,
    );
    const rejected = await librarian
      .post(`/api/verifications/${profileId}/reject`)
      .send({ reason: 'Photo is blurry' });
    expect(rejected.body).toMatchObject({
      verificationStatus: 'rejected',
      verificationNote: 'Photo is blurry',
    });

    const again = await member.post('/api/member/id-proof').send({ idProof: PDF_DATA_URL });
    expect(again.body.verificationStatus).toBe('pending');
    expect((await librarian.get('/api/verifications')).body).toHaveLength(1);
  });

  it('keeps ID proofs inside the library: other libraries’ staff and members get nothing', async () => {
    await setup();
    await join();
    const other = await createLibrary('town');
    await createUser({ libraryId: other.id, role: 'librarian', email: 'staff@town.test' });
    const outsider = await signedInAgent(app, 'staff@town.test');

    const ownStaff = await signedInAgent(app, 'staff@city.test');
    const [{ profileId }] = (await ownStaff.get('/api/verifications')).body;

    expect((await outsider.get('/api/verifications')).body).toEqual([]);
    expect((await outsider.get(`/api/verifications/${profileId}/id-proof`)).status).toBe(404);
    expect((await outsider.post(`/api/verifications/${profileId}/approve`).send({})).status).toBe(
      404,
    );

    const member = await signedInAgent(app, 'meera@x.test', { password: 'Meera-pass1' });
    expect((await member.get('/api/verifications')).status).toBe(403);
  });

  it('never serves private files through the public file route', async () => {
    const { librarian } = await setup();
    await join();
    const [{ profileId }] = (await librarian.get('/api/verifications')).body;
    expect(profileId).toBeTruthy();
    const res = await request(app).get('/api/files/private/id-proofs/anything.png');
    expect(res.status).toBe(404);
  });
});
