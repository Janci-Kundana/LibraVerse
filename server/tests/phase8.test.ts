import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app';
import { runWithTenant } from '../src/core/tenant';
import { setAssistantClient } from '../src/modules/assistant/service';
import { AuditLogModel } from '../src/modules/audit/model';
import { setGoogleVerifier } from '../src/modules/auth/service';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';
import mongoose from 'mongoose';

useTestDb();
const app = createApp();

async function libraryWithActivity() {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
  const admin = await signedInAgent(app, 'owner@city.test');
  const book = (
    await admin
      .post('/api/books')
      .send({
        title: 'Wings of Fire',
        authors: ['A. P. J. Abdul Kalam'],
        category: 'Biography',
        copies: { count: 2, branchId: String(lib.branch._id) },
      })
  ).body;
  const m = await activeMember(app, lib.id, 'reader@city.test');
  await admin
    .post('/api/circulation/issue')
    .send({ memberToken: m.token, copyCode: book.copyList[0].qrCode });
  return { lib, admin, m, book };
}

describe('reports (FR-11)', () => {
  it('dashboard totals, charts data and popular books', async () => {
    const { admin } = await libraryWithActivity();
    const res = await admin.get('/api/reports/dashboard');
    expect(res.body.totals).toMatchObject({
      members: 1,
      titles: 1,
      copies: 2,
      activeLoans: 1,
      overdueLoans: 0,
    });
    expect(res.body.revenueByMonth).toHaveLength(12);
    expect(res.body.loansByDay).toHaveLength(30);
    expect(res.body.loansByDay.at(-1).value).toBe(1);
    expect(res.body.popularBooks).toEqual([
      expect.objectContaining({ title: 'Wings of Fire', borrows: 1 }),
    ]);
  });

  it('exports Excel and PDF; librarians cannot', async () => {
    const { admin, lib } = await libraryWithActivity();
    const xlsx = await admin
      .get('/api/reports/loans.xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const pdf = await admin.get('/api/reports/overdue.pdf').buffer(true);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await admin.get('/api/reports/secrets.pdf')).status).toBe(404);
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    expect(
      (await (await signedInAgent(app, 'staff@city.test')).get('/api/reports/dashboard')).status,
    ).toBe(403);
  });

  it('shows the audit log and detects tampering', async () => {
    const { admin, lib } = await libraryWithActivity();
    const log = await admin.get('/api/audit?action=loan');
    expect(log.body.items[0]).toMatchObject({
      action: 'loan.issued',
      actorName: 'libraryAdmin owner@city.test',
    });
    expect((await admin.get('/api/audit/verify')).body).toEqual({
      intact: true,
      brokenAtSeq: null,
    });
    await mongoose.connection
      .collection('auditLogs')
      .updateOne({ action: 'loan.issued' }, { $set: { action: 'loan.hidden' } });
    expect((await admin.get('/api/audit/verify')).body.intact).toBe(false);
    expect(await runWithTenant(lib.id, () => AuditLogModel.countDocuments())).toBeGreaterThan(0);
  });

  it('platform analytics show library-level totals to the Super Admin only', async () => {
    await libraryWithActivity();
    await createLibrary('town', 'pending');
    await createUser({ libraryId: null, role: 'superAdmin', email: 'root@platform.test' });
    const root = await signedInAgent(app, 'root@platform.test');
    const res = await root.get('/api/admin/reports/dashboard');
    expect(res.body).toMatchObject({
      librariesByStatus: { active: 1, pending: 1 },
      totalMembers: 1,
    });
    expect(res.body.topLibraries).toEqual([
      { id: expect.any(String), name: 'Library city', members: 1 },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('reader@city.test');
    const owner = await signedInAgent(app, 'owner@city.test');
    expect((await owner.get('/api/admin/reports/dashboard')).status).toBe(403);
  });
});

describe('AI assistant (FR-25)', () => {
  afterEach(() => setAssistantClient(null));

  it('is off without an API key', async () => {
    const { m } = await libraryWithActivity();
    expect((await m.agent.get('/api/member/assistant/status')).body.enabled).toBe(false);
    expect(
      (
        await m.agent
          .post('/api/member/assistant')
          .send({ messages: [{ role: 'user', content: 'hi' }] })
      ).status,
    ).toBe(503);
  });

  it('answers from this library’s catalog through tools', async () => {
    const { m } = await libraryWithActivity();
    // Another library's book must never reach the tool results.
    const other = await createLibrary('town');
    await createUser({ libraryId: other.id, role: 'librarian', email: 'staff@town.test' });
    await (
      await signedInAgent(app, 'staff@town.test')
    )
      .post('/api/books')
      .send({ title: 'Wings of Desire', category: 'Biography' });

    const requests: Anthropic.Beta.MessageCreateParams[] = [];
    let call = 0;
    setAssistantClient({
      beta: {
        messages: {
          create: async (params: Anthropic.Beta.MessageCreateParams) => {
            requests.push(JSON.parse(JSON.stringify(params)));
            call++;
            return call === 1
              ? {
                  stop_reason: 'tool_use',
                  content: [
                    {
                      type: 'tool_use',
                      id: 't1',
                      name: 'search_catalog',
                      input: { query: 'wings' },
                    },
                  ],
                }
              : {
                  stop_reason: 'end_turn',
                  content: [{ type: 'text', text: 'Yes, Wings of Fire has 1 copy on the shelf.' }],
                };
          },
        },
      },
    } as unknown as Anthropic);

    const res = await m.agent
      .post('/api/member/assistant')
      .send({ messages: [{ role: 'user', content: 'Is Wings of Fire available?' }] });
    expect(res.body.reply).toBe('Yes, Wings of Fire has 1 copy on the shelf.');
    expect(requests[0]).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'low' },
    });
    const toolResult = JSON.stringify(requests[1]!.messages.at(-1));
    expect(toolResult).toContain('Wings of Fire');
    expect(toolResult).toContain('\\"onShelf\\":1');
    expect(toolResult).not.toContain('Wings of Desire');
  });
});

describe('Google sign-in (FR-04)', () => {
  afterEach(() => setGoogleVerifier(null));

  it('signs in an existing account whose Google email is verified', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'member', email: 'reader@city.test' });
    setGoogleVerifier(async (t) =>
      t === 'good-token-xxxxxxxxxxxxx'
        ? { email: 'Reader@city.test', email_verified: true }
        : undefined,
    );
    expect((await request(app).get('/api/auth/config')).body.googleClientId).toBe(
      'test-client.apps.googleusercontent.com',
    );

    const ok = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'good-token-xxxxxxxxxxxxx' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('reader@city.test');
    expect(
      (await request(app).post('/api/auth/google').send({ credential: 'bad-token-xxxxxxxxxxxxxx' }))
        .status,
    ).toBe(401);
  });

  it('never creates accounts, and rejects unverified emails', async () => {
    setGoogleVerifier(async () => ({ email: 'stranger@x.test', email_verified: true }));
    const res = await request(app)
      .post('/api/auth/google')
      .send({ credential: 'good-token-xxxxxxxxxxxxx' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NO_ACCOUNT');
    setGoogleVerifier(async () => ({ email: 'x@x.test', email_verified: false }));
    expect(
      (await request(app).post('/api/auth/google').send({ credential: 'good-token-xxxxxxxxxxxxx' }))
        .status,
    ).toBe(401);
  });
});
