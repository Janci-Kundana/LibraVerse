import request from 'supertest';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { MemberProfileModel } from '../src/modules/members/model';
import {
  activeMember,
  createLibrary,
  createUser,
  PNG_DATA_URL,
  signedInAgent,
} from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

async function setup() {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  const staff = await signedInAgent(app, 'staff@city.test');
  return { lib, staff };
}

const photoKey = (libId: string, profileId: unknown) =>
  runWithTenant(libId, async () => (await MemberProfileModel.findById(profileId).lean())!);

describe('card photo: required at join, changes approved by staff', () => {
  it('joining without a photo is refused', async () => {
    await setup();
    const res = await request(app).post('/api/members/join').send({
      librarySlug: 'city',
      name: 'Meera Nair',
      email: 'meera@x.test',
      password: 'Meera-pass1',
      idProof: PNG_DATA_URL,
      acceptTerms: true,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Add a clear photo of your face for your card');
  });

  it('before the ID is approved the member can replace the photo directly', async () => {
    const { lib } = await setup();
    const agent = request.agent(app);
    await agent.post('/api/members/join').send({
      librarySlug: 'city',
      name: 'Meera Nair',
      email: 'meera@x.test',
      password: 'Meera-pass1',
      idProof: PNG_DATA_URL,
      photo: PNG_DATA_URL,
      acceptTerms: true,
    });
    const first = (await agent.get('/api/member/profile')).body;
    expect(first).toMatchObject({ hasPhoto: true, photoChange: null });
    const before = (await photoKey(lib.id, first.id)).photoKey;
    const res = await agent.post('/api/member/photo').send({ photo: PNG_DATA_URL });
    expect(res.body).toMatchObject({ hasPhoto: true, photoChange: null });
    expect((await photoKey(lib.id, first.id)).photoKey).not.toBe(before);
  });

  it('after approval a new photo waits; staff compare and approve it', async () => {
    const { lib, staff } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const res = await m.agent.post('/api/member/photo').send({ photo: PNG_DATA_URL });
    expect(res.body).toMatchObject({
      hasPhoto: false,
      photoChange: { status: 'pending', note: null },
    });
    // The card keeps its (missing) photo until staff approve.
    expect((await m.agent.get('/api/member/photo')).status).toBe(404);
    expect((await m.agent.get('/api/member/photo/pending')).status).toBe(200);

    const queue = (await staff.get('/api/verifications/photo-changes')).body;
    expect(queue).toEqual([
      expect.objectContaining({
        profileId: String(m.profile._id),
        email: 'reader@city.test',
        hasCurrentPhoto: false,
      }),
    ]);
    const photo = await staff.get(
      `/api/verifications/photo-changes/${String(m.profile._id)}/photo`,
    );
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');

    const approve = () =>
      staff.post(`/api/verifications/photo-changes/${String(m.profile._id)}/approve`);
    expect((await approve()).status).toBe(204);
    const p = await photoKey(lib.id, m.profile._id);
    expect(p.photoKey).toEqual(expect.any(String));
    expect(p.photoChange).toBeNull();
    expect((await m.agent.get('/api/member/photo')).status).toBe(200);
    expect(testOutbox.at(-1)?.subject).toMatch(/new card photo is approved/);
    expect(
      await runWithTenant(lib.id, () =>
        AuditLogModel.countDocuments({ action: 'member.photoApproved' }),
      ),
    ).toBe(1);
    // Nothing is waiting any more, so a second approval changes nothing.
    expect((await approve()).body.error.code).toBe('NO_PHOTO_CHANGE');
    expect((await staff.get('/api/verifications/photo-changes')).body).toEqual([]);
  });

  it('staff reject with a reason; the member sees it and can try again', async () => {
    const { lib, staff } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    await m.agent.post('/api/member/photo').send({ photo: PNG_DATA_URL });
    const url = `/api/verifications/photo-changes/${String(m.profile._id)}/reject`;
    expect((await staff.post(url).send({})).status).toBe(400);
    expect((await staff.post(url).send({ reason: 'Face is not clearly visible' })).status).toBe(
      204,
    );
    expect((await m.agent.get('/api/member/profile')).body.photoChange).toMatchObject({
      status: 'rejected',
      note: 'Face is not clearly visible',
    });
    expect(testOutbox.at(-1)?.text).toMatch(/Reason: Face is not clearly visible/);
    expect((await photoKey(lib.id, m.profile._id)).photoKey).toBeNull();

    const again = await m.agent.post('/api/member/photo').send({ photo: PNG_DATA_URL });
    expect(again.body.photoChange).toMatchObject({ status: 'pending', note: null });
  });

  it('only this library’s staff see and decide its photo changes', async () => {
    const { lib } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    await m.agent.post('/api/member/photo').send({ photo: PNG_DATA_URL });
    const other = await createLibrary('town');
    await createUser({ libraryId: other.id, role: 'librarian', email: 'staff@town.test' });
    const outsider = await signedInAgent(app, 'staff@town.test');
    const id = String(m.profile._id);
    expect((await outsider.get('/api/verifications/photo-changes')).body).toEqual([]);
    expect((await outsider.get(`/api/verifications/photo-changes/${id}/photo`)).status).toBe(404);
    expect((await outsider.post(`/api/verifications/photo-changes/${id}/approve`)).status).toBe(
      409,
    );
    expect((await m.agent.get('/api/verifications/photo-changes')).status).toBe(403);
    expect((await photoKey(lib.id, m.profile._id)).photoChange?.status).toBe('pending');
  });
});
