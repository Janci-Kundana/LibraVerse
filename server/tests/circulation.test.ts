import request from 'supertest';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runWithTenant } from '../src/core/tenant';
import {
  expireReservationHolds,
  sendExpiryReminders,
  sendLoanReminders,
} from '../src/jobs/circulation';
import { AuditLogModel } from '../src/modules/audit/model';
import { BookModel } from '../src/modules/books/model';
import { cardToken, verifyCardToken } from '../src/modules/card/token';
import { DAY_MS } from '../src/modules/circulation/rules';
import { BookCopyModel } from '../src/modules/copies/model';
import { LoanModel } from '../src/modules/loans/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

async function setup(copies = 3) {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  const staff = await signedInAgent(app, 'staff@city.test');
  const book = (
    await staff.post('/api/books').send({
      title: 'Dune',
      authors: ['Frank Herbert'],
      copies: { count: copies, branchId: String(lib.branch._id), shelf: 'A-1' },
    })
  ).body;
  const codes: string[] = book.copyList.map((c: { qrCode: string }) => c.qrCode);
  return { lib, staff, book, codes };
}

/** Moves a loan's due date into the past, as if time had passed. */
function backdate(libraryId: string, loanId: string, daysLate: number) {
  return runWithTenant(libraryId, () =>
    LoanModel.updateOne(
      { _id: loanId },
      { $set: { dueAt: new Date(Date.now() - daysLate * DAY_MS + 60_000) } },
    ),
  );
}

describe('signed card QR (rule 4)', () => {
  const member = '64b000000000000000000001';
  const lib = '64b0000000000000000000aa';

  it('verifies a genuine token and rejects any edit', () => {
    const token = cardToken(member, lib);
    expect(verifyCardToken(token, lib)).toBe(member);
    const forgedMember = token.replace(member, '64b000000000000000000002');
    expect(() => verifyCardToken(forgedMember, lib)).toThrow(/not a valid/);
    expect(() => verifyCardToken(`${token.slice(0, -2)}xx`, lib)).toThrow(/not a valid/);
    expect(() => verifyCardToken('hello', lib)).toThrow(/not a valid/);
  });

  it('rejects a genuine card from another library', () => {
    expect(() => verifyCardToken(cardToken(member, lib), '64b0000000000000000000bb')).toThrow(
      /different library/,
    );
  });

  it('a forged QR is rejected at the counter', async () => {
    const { lib: l, staff } = await setup();
    const m = await activeMember(app, l.id, 'reader@city.test');
    const forged = m.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const res = await staff.post('/api/circulation/scan-member').send({ memberToken: forged });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_CARD');
  });
});

describe('issue by two scans (FR-15)', () => {
  it('scans the card, then the book, and issues it for the loan period', async () => {
    const { lib, staff, codes, book } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');

    const scan = await staff.post('/api/circulation/scan-member').send({ memberToken: m.token });
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({
      name: 'member reader@city.test',
      canBorrow: true,
      bookLimit: 2,
      pendingDues: 0,
    });

    const issued = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: m.token, copyCode: codes[0] });
    expect(issued.status).toBe(201);
    expect(issued.body).toMatchObject({
      bookTitle: 'Dune',
      copyCode: codes[0],
      status: 'active',
      renewals: 0,
    });
    const days = (Date.parse(issued.body.dueAt) - Date.parse(issued.body.issuedAt)) / DAY_MS;
    expect(days).toBe(14);

    await runWithTenant(lib.id, async () => {
      expect((await BookCopyModel.findOne({ qrCode: codes[0] }).lean())?.status).toBe('issued');
      expect((await BookModel.findById(book.id).lean())?.borrowCount).toBe(1);
      const audit = await AuditLogModel.findOne({ action: 'loan.issued' }).lean();
      expect(audit).toMatchObject({ actorRole: 'librarian', details: { copyCode: codes[0] } });
    });

    const again = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: m.token, copyCode: codes[0] });
    expect(again.status).toBe(409);
  });

  it('enforces the plan’s borrowing limit', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test', { bookLimit: 1 });
    await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] });
    const res = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: m.token, copyCode: codes[1] });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'BORROW_BLOCKED',
      message: 'Borrowing limit reached (1 book on this plan)',
    });
  });

  it('blocks members without an active membership, with the reason', async () => {
    const { lib, staff, codes } = await setup();
    const expired = await activeMember(app, lib.id, 'old@city.test', { validDays: -1 });
    const res = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: expired.token, copyCode: codes[0] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/^Membership expired on /);

    const noPlan = await activeMember(app, lib.id, 'new@city.test');
    await runWithTenant(lib.id, () =>
      MemberProfileModel.updateOne({ _id: noPlan.profile._id }, { planId: null }),
    );
    const scan = await staff
      .post('/api/circulation/scan-member')
      .send({ memberToken: noPlan.token });
    expect(scan.body).toMatchObject({
      canBorrow: false,
      membershipStatus: 'none',
      blockedReason: 'No active membership plan',
    });
  });

  it('TC-05: a member with a pending fine is blocked with the reason shown', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test', { finePerDay: 500 });
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    await backdate(lib.id, loan.id, 3);
    await staff.post('/api/circulation/return').send({ copyCode: codes[0] });

    const scan = await staff.post('/api/circulation/scan-member').send({ memberToken: m.token });
    expect(scan.body).toMatchObject({
      canBorrow: false,
      pendingDues: 1500,
      blockedReason: 'Pending fine of ₹15. Collect payment before issuing.',
    });
    const issue = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: m.token, copyCode: codes[1] });
    expect(issue.status).toBe(409);
    expect(issue.body.error.message).toBe('Pending fine of ₹15. Collect payment before issuing.');
  });

  it('an overdue book blocks new loans', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    await backdate(lib.id, loan.id, 1);
    const scan = await staff.post('/api/circulation/scan-member').send({ memberToken: m.token });
    expect(scan.body.blockedReason).toBe('1 overdue book must be returned first');
  });
});

describe('returns (FR-16)', () => {
  it('TC-06: returning 3 days late at ₹5/day adds a ₹15 fine to the member', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test', { finePerDay: 500 });
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    await backdate(lib.id, loan.id, 3);

    const preview = await staff.get(`/api/circulation/copies/${codes[0]}`);
    expect(preview.body.activeLoan).toMatchObject({ overdueDays: 3, fineAmount: 1500 });

    const res = await staff.post('/api/circulation/return').send({ copyCode: codes[0] });
    expect(res.status).toBe(200);
    expect(res.body.loan).toMatchObject({
      status: 'returned',
      overdueDays: 3,
      fineAmount: 1500,
      duesPaid: false,
    });

    const mine = await m.agent.get('/api/member/loans');
    expect(mine.body.pendingDues).toBe(1500);
    expect(testOutbox.at(-1)).toMatchObject({
      to: 'reader@city.test',
      subject: 'First reminder: ₹15 unpaid at Library city',
    });

    await runWithTenant(lib.id, async () => {
      expect((await BookCopyModel.findOne({ qrCode: codes[0] }).lean())?.status).toBe('available');
      expect(await AuditLogModel.findOne({ action: 'loan.returned' }).lean()).toMatchObject({
        details: { overdueDays: 3, fineAmount: 1500 },
      });
    });
  });

  it('an on-time return has no fine', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] });
    const res = await staff.post('/api/circulation/return').send({ copyCode: codes[0] });
    expect(res.body.loan).toMatchObject({ overdueDays: 0, fineAmount: 0 });
    expect((await staff.post('/api/circulation/return').send({ copyCode: codes[0] })).status).toBe(
      409,
    );
  });

  it('records damage and lost-book charges', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] });
    const damaged = await staff.post('/api/circulation/return').send({
      copyCode: codes[0],
      condition: 'damaged',
      damageCharge: 20000,
      note: 'Water damage',
    });
    expect(damaged.body.loan).toMatchObject({ damageCharge: 20000, chargeNote: 'Water damage' });

    const loan2 = (
      await staff.post('/api/circulation/issue').send({
        memberToken: (await activeMember(app, lib.id, 'b@city.test')).token,
        copyCode: codes[1],
      })
    ).body;
    const lost = await staff.post(`/api/circulation/loans/${loan2.id}/lost`);
    expect(lost.body).toMatchObject({
      status: 'lost',
      damageCharge: 50000,
      chargeNote: 'Book lost',
    });

    await runWithTenant(lib.id, async () => {
      expect((await BookCopyModel.findOne({ qrCode: codes[0] }).lean())?.status).toBe('damaged');
      expect((await BookCopyModel.findOne({ qrCode: codes[1] }).lean())?.status).toBe('lost');
    });
  });
});

describe('renewals (FR-22)', () => {
  it('a member renews their own loan up to the limit', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;

    const r1 = await m.agent.post(`/api/member/loans/${loan.id}/renew`);
    expect(r1.status).toBe(200);
    expect(Date.parse(r1.body.dueAt) - Date.parse(loan.dueAt)).toBe(14 * DAY_MS);
    await m.agent.post(`/api/member/loans/${loan.id}/renew`);
    const r3 = await m.agent.post(`/api/member/loans/${loan.id}/renew`);
    expect(r3.status).toBe(409);
    expect(r3.body.error.code).toBe('RENEW_LIMIT');

    const other = await activeMember(app, lib.id, 'other@city.test');
    expect((await other.agent.post(`/api/member/loans/${loan.id}/renew`)).status).toBe(404);
  });

  it('refuses overdue loans and books someone is waiting for', async () => {
    const { lib, staff, codes } = await setup(1);
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;

    const waiting = await activeMember(app, lib.id, 'next@city.test');
    await waiting.agent.post('/api/member/reservations').send({ bookId: loan.bookId });
    expect((await m.agent.post(`/api/member/loans/${loan.id}/renew`)).body.error.code).toBe(
      'RENEW_RESERVED',
    );

    await backdate(lib.id, loan.id, 1);
    expect((await staff.post(`/api/circulation/loans/${loan.id}/renew`)).body.error.code).toBe(
      'RENEW_OVERDUE',
    );
  });
});

describe('reservations', () => {
  it('TC-09: a returned reserved book is held for the next member, who is notified', async () => {
    const { lib, staff, codes, book } = await setup(1);
    const a = await activeMember(app, lib.id, 'a@city.test');
    const b = await activeMember(app, lib.id, 'b@city.test');
    const c = await activeMember(app, lib.id, 'c@city.test');
    await staff.post('/api/circulation/issue').send({ memberToken: a.token, copyCode: codes[0] });

    const rb = await b.agent.post('/api/member/reservations').send({ bookId: book.id });
    const rc = await c.agent.post('/api/member/reservations').send({ bookId: book.id });
    expect(rb.body).toMatchObject({ status: 'waiting', position: 1 });
    expect(rc.body).toMatchObject({ status: 'waiting', position: 2 });
    expect((await b.agent.post('/api/member/reservations').send({ bookId: book.id })).status).toBe(
      409,
    );

    const ret = await staff.post('/api/circulation/return').send({ copyCode: codes[0] });
    expect(ret.body.heldFor).toBe('member b@city.test');
    expect(testOutbox.at(-1)).toMatchObject({
      to: 'b@city.test',
      subject: '"Dune" is ready for you',
    });

    const bView = await b.agent.get('/api/member/loans');
    expect(bView.body.reservations[0]).toMatchObject({ status: 'ready', copyCode: codes[0] });
    expect((await c.agent.get('/api/member/loans')).body.reservations[0].position).toBe(1);

    const wrong = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: c.token, copyCode: codes[0] });
    expect(wrong.body.error.code).toBe('COPY_HELD');
    const right = await staff
      .post('/api/circulation/issue')
      .send({ memberToken: b.token, copyCode: codes[0] });
    expect(right.status).toBe(201);
    expect((await b.agent.get('/api/member/loans')).body.reservations).toEqual([]);
  });

  it('only reserves books with no copy on the shelf', async () => {
    const { lib, book } = await setup(1);
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const res = await m.agent.post('/api/member/reservations').send({ bookId: book.id });
    expect(res.body.error.code).toBe('COPIES_AVAILABLE');
  });

  it('an uncollected hold expires and passes to the next member', async () => {
    const { lib, staff, codes, book } = await setup(1);
    const a = await activeMember(app, lib.id, 'a@city.test');
    const b = await activeMember(app, lib.id, 'b@city.test');
    const c = await activeMember(app, lib.id, 'c@city.test');
    await staff.post('/api/circulation/issue').send({ memberToken: a.token, copyCode: codes[0] });
    await b.agent.post('/api/member/reservations').send({ bookId: book.id });
    await c.agent.post('/api/member/reservations').send({ bookId: book.id });
    await staff.post('/api/circulation/return').send({ copyCode: codes[0] });

    expect(await expireReservationHolds(lib.id, new Date(Date.now() + 4 * DAY_MS))).toBe(1);
    expect((await c.agent.get('/api/member/loans')).body.reservations[0].status).toBe('ready');
  });

  it('cancelling a ready hold releases the copy', async () => {
    const { lib, staff, codes, book } = await setup(1);
    const a = await activeMember(app, lib.id, 'a@city.test');
    const b = await activeMember(app, lib.id, 'b@city.test');
    await staff.post('/api/circulation/issue').send({ memberToken: a.token, copyCode: codes[0] });
    const r = (await b.agent.post('/api/member/reservations').send({ bookId: book.id })).body;
    await staff.post('/api/circulation/return').send({ copyCode: codes[0] });
    expect((await b.agent.delete(`/api/member/reservations/${r.id}`)).status).toBe(204);
    const copy = await staff.get(`/api/circulation/copies/${codes[0]}`);
    expect(copy.body.status).toBe('available');
  });
});

describe('member card and loans', () => {
  it('the card’s QR token is accepted at the counter; an overdue book does not block the card', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const card = await m.agent.get('/api/member/card');
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ status: 'active', libraryInitial: 'L', revealed: false });
    expect(card.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(
      (await staff.post('/api/circulation/scan-member').send({ memberToken: card.body.qrToken }))
        .status,
    ).toBe(200);

    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    await backdate(lib.id, loan.id, 2);
    // Only an exhausted deposit with dues still owed blocks the card (borrowing is still refused).
    expect((await m.agent.get('/api/member/card')).body.status).toBe('active');

    await m.agent.post('/api/member/card/revealed');
    expect((await m.agent.get('/api/member/card')).body.revealed).toBe(true);
  });

  it('staff list overdue loans and search by member', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    await backdate(lib.id, loan.id, 2);
    const overdue = await staff.get('/api/circulation/loans?status=overdue&q=reader');
    expect(overdue.body.map((l: { id: string }) => l.id)).toEqual([loan.id]);
    expect((await request(app).get('/api/circulation/loans')).status).toBe(401);
    expect(
      (await m.agent.post('/api/circulation/scan-member').send({ memberToken: m.token })).status,
    ).toBe(403);
  });
});

describe('reminder jobs (FR-28)', () => {
  it('sends due-soon once, overdue at most daily, and expiry once', async () => {
    const { lib, staff, codes } = await setup();
    const m = await activeMember(app, lib.id, 'reader@city.test', { validDays: 5 });
    const loan = (
      await staff.post('/api/circulation/issue').send({ memberToken: m.token, copyCode: codes[0] })
    ).body;
    testOutbox.length = 0;

    const dueSoonAt = new Date(Date.parse(loan.dueAt) - DAY_MS);
    expect(await sendLoanReminders(lib.id, dueSoonAt)).toEqual({ dueSoon: 1, overdue: 0 });
    expect(await sendLoanReminders(lib.id, dueSoonAt)).toEqual({ dueSoon: 0, overdue: 0 });

    const late = new Date(Date.parse(loan.dueAt) + 2 * DAY_MS);
    expect((await sendLoanReminders(lib.id, late)).overdue).toBe(1);
    expect((await sendLoanReminders(lib.id, new Date(late.getTime() + 60_000))).overdue).toBe(0);
    expect((await sendLoanReminders(lib.id, new Date(late.getTime() + DAY_MS))).overdue).toBe(1);
    expect(testOutbox.map((m) => m.subject)).toEqual([
      expect.stringMatching(/^"Dune" is due on/),
      '"Dune" is 2 days overdue',
      '"Dune" is 3 days overdue',
    ]);

    expect(await sendExpiryReminders(lib.id)).toBe(1);
    expect(await sendExpiryReminders(lib.id)).toBe(0);
  });
});
