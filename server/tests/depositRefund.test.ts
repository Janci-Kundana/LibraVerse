import { Types } from 'mongoose';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { DepositTransactionModel } from '../src/modules/dues/model';
import { LoanModel } from '../src/modules/loans/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { setGatewayFactory, type Gateway } from '../src/modules/payments/gateway';
import { PaymentModel } from '../src/modules/payments/model';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

const refunds: { paymentId: string; amount: number }[] = [];
let failRefunds = false;
beforeAll(() =>
  setGatewayFactory((): Gateway => ({
    keyId: 'rzp_test_abcdefgh',
    createOrder: async () => ({ id: 'order_x' }),
    fetchOrderPayments: async () => [],
    refund: async (paymentId, amount) => {
      if (failRefunds) throw new Error('razorpay down');
      refunds.push({ paymentId, amount });
      return { id: `rfnd_${refunds.length}` };
    },
  })),
);
afterAll(() => setGatewayFactory());
beforeEach(() => {
  refunds.length = 0;
  failRefunds = false;
});

async function setup(deposit: number) {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  const admin = await signedInAgent(app, 'owner@city.test');
  await admin.put('/api/library/payment-settings').send({
    keyId: 'rzp_test_abcdefgh',
    keySecret: 'secret_key_123',
    webhookSecret: 'whsec_test_123456',
  });
  const staff = await signedInAgent(app, 'staff@city.test');
  const m = await activeMember(app, lib.id, 'reader@city.test');
  await runWithTenant(lib.id, () =>
    MemberProfileModel.updateOne(
      { _id: m.profile._id },
      { $set: { depositBalance: deposit, depositCollectedAt: new Date() } },
    ),
  );
  return { lib, admin, staff, m, profileId: String(m.profile._id) };
}

/** The deposit was paid online with a membership payment (so Razorpay can refund it). */
function paidOnline(
  libId: string,
  memberId: Types.ObjectId,
  deposit: number,
  razorpayPaymentId = 'pay_dep',
) {
  return runWithTenant(libId, () =>
    PaymentModel.create({
      memberId,
      purpose: 'membership',
      method: 'online',
      amount: 49900 + deposit,
      depositAmount: deposit,
      status: 'success',
      paidAt: new Date(),
      razorpayPaymentId,
      expiresAt: new Date(),
    }),
  );
}

function due(libId: string, memberId: Types.ObjectId, amount: number) {
  return runWithTenant(libId, () =>
    LoanModel.create({
      copyId: new Types.ObjectId(),
      bookId: new Types.ObjectId(),
      memberId,
      issuedBy: memberId,
      issuedAt: new Date(),
      dueAt: new Date(),
      returnedAt: new Date(),
      status: 'returned',
      finePerDay: 500,
      fineAmount: amount,
    }),
  );
}

describe('deposit refund', () => {
  it('nothing to refund when the deposit is ₹0', async () => {
    const { m } = await setup(0);
    const view = (await m.agent.get('/api/member/deposit-refund')).body;
    expect(view).toMatchObject({
      amount: 0,
      blockedReason: 'Your deposit is ₹0, so there is nothing to refund',
    });
    const res = await m.agent.post('/api/member/deposit-refund').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_REFUND');
  });

  it('nothing to refund when unpaid dues use up the whole deposit', async () => {
    const { lib, m } = await setup(10000);
    await due(lib.id, m.user._id, 30000);
    expect((await m.agent.post('/api/member/deposit-refund').send({})).body.error.message).toMatch(
      /unpaid dues \(₹300\) use up the whole deposit/,
    );
  });

  it('books must be returned first', async () => {
    const { lib, m } = await setup(50000);
    await runWithTenant(lib.id, () =>
      LoanModel.create({
        copyId: new Types.ObjectId(),
        bookId: new Types.ObjectId(),
        memberId: m.user._id,
        issuedBy: m.user._id,
        issuedAt: new Date(),
        dueAt: new Date(Date.now() + 9e8),
        finePerDay: 500,
      }),
    );
    expect((await m.agent.post('/api/member/deposit-refund').send({})).body.error.message).toBe(
      'Return the 1 book you have first',
    );
  });

  it('cash: dues come out of the deposit first, the rest is refunded, and the membership closes', async () => {
    const { lib, staff, m, profileId } = await setup(50000);
    await due(lib.id, m.user._id, 30000);
    const req = await m.agent.post('/api/member/deposit-refund').send({ reason: 'Moving to Pune' });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ status: 'requested', amount: 20000, outstandingDues: 30000 });
    expect(testOutbox.at(-1)?.subject).toBe('We received your deposit refund request');

    const queue = (await staff.get('/api/deposit-refunds')).body;
    expect(queue).toEqual([
      expect.objectContaining({
        profileId,
        refundable: 20000,
        reason: 'Moving to Pune',
        razorpayRefundable: 0,
      }),
    ]);

    const done = await staff
      .post(`/api/deposit-refunds/${profileId}/approve`)
      .send({ method: 'cash' });
    expect(done.body).toEqual({ amount: 20000, duesSettled: 30000, method: 'cash' });

    const p = await runWithTenant(lib.id, () => MemberProfileModel.findById(profileId).lean());
    expect(p).toMatchObject({
      depositBalance: 0,
      planId: null,
      depositRefund: { status: 'completed', method: 'cash', amount: 20000, duesSettled: 30000 },
    });
    expect(p?.membershipClosedAt).toBeInstanceOf(Date);
    const tx = await runWithTenant(lib.id, () =>
      DepositTransactionModel.find().sort({ createdAt: 1 }).lean(),
    );
    expect(tx.map((t) => [t.type, t.amount, t.balanceAfter])).toEqual([
      ['deduction', 30000, 20000],
      ['refund', 20000, 0],
    ]);
    expect(
      await runWithTenant(lib.id, () =>
        AuditLogModel.countDocuments({ action: 'deposit.refunded' }),
      ),
    ).toBe(1);
    expect(testOutbox.at(-1)?.subject).toBe('₹200 deposit refunded');

    // The card no longer works and borrowing is refused; the member owes nothing.
    const standing = (await m.agent.get('/api/member/standing')).body;
    expect(standing).toMatchObject({ depositBalance: 0, outstandingDues: 0, cardStatus: 'none' });
    const scan = (await staff.post('/api/circulation/scan-member').send({ memberToken: m.token }))
      .body;
    expect(scan).toMatchObject({ canBorrow: false, blockedReason: 'No active membership plan' });

    // Approving again pays nothing twice.
    expect(
      (await staff.post(`/api/deposit-refunds/${profileId}/approve`).send({ method: 'cash' }))
        .status,
    ).toBe(409);
  });

  it('Razorpay: refunds back to the online payment the deposit came from', async () => {
    const { lib, staff, m, profileId } = await setup(50000);
    await paidOnline(lib.id, m.user._id, 50000);
    await m.agent.post('/api/member/deposit-refund').send({});
    expect((await staff.get('/api/deposit-refunds')).body[0].razorpayRefundable).toBe(50000);
    await staff.post(`/api/deposit-refunds/${profileId}/approve`).send({ method: 'razorpay' });
    expect(refunds).toEqual([{ paymentId: 'pay_dep', amount: 50000 }]);
    const pay = await runWithTenant(lib.id, () => PaymentModel.findOne().lean());
    expect(pay?.depositRefunded).toBe(50000);
    expect(testOutbox.at(-1)?.text).toMatch(/to your original payment method/);
  });

  it('Razorpay is refused for a deposit paid in cash', async () => {
    const { staff, m, profileId } = await setup(50000);
    await m.agent.post('/api/member/deposit-refund').send({});
    const res = await staff
      .post(`/api/deposit-refunds/${profileId}/approve`)
      .send({ method: 'razorpay' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('USE_CASH');
    expect((await m.agent.get('/api/member/deposit-refund')).body.status).toBe('requested');
  });

  it('a Razorpay failure leaves the deposit untouched and the request open', async () => {
    const { lib, staff, m, profileId } = await setup(50000);
    await paidOnline(lib.id, m.user._id, 50000);
    await m.agent.post('/api/member/deposit-refund').send({});
    failRefunds = true;
    expect(
      (await staff.post(`/api/deposit-refunds/${profileId}/approve`).send({ method: 'razorpay' }))
        .status,
    ).toBe(502);
    const p = await runWithTenant(lib.id, () => MemberProfileModel.findById(profileId).lean());
    expect(p).toMatchObject({ depositBalance: 50000, depositRefund: { status: 'requested' } });
    expect(p?.planId).not.toBeNull();
  });

  it('staff can reject; members can cancel; one open request at a time', async () => {
    const { staff, m, profileId } = await setup(50000);
    await m.agent.post('/api/member/deposit-refund').send({});
    expect((await m.agent.post('/api/member/deposit-refund').send({})).body.error.code).toBe(
      'ALREADY_REQUESTED',
    );
    expect(
      (
        await staff
          .post(`/api/deposit-refunds/${profileId}/reject`)
          .send({ reason: 'Please clear the damaged-book review first' })
      ).status,
    ).toBe(204);
    expect(testOutbox.at(-1)?.text).toMatch(/Reason: Please clear the damaged-book review first/);
    expect((await m.agent.get('/api/member/deposit-refund')).body.status).toBe('rejected');

    await m.agent.post('/api/member/deposit-refund').send({});
    expect((await m.agent.delete('/api/member/deposit-refund')).body.status).toBe('cancelled');
    expect((await staff.get('/api/deposit-refunds')).body).toEqual([]);
  });

  it('staff can refund at the counter directly; the member can rejoin with a new deposit', async () => {
    const { lib, admin, staff, m, profileId } = await setup(50000);
    const res = await staff
      .post(`/api/deposit-refunds/${profileId}/refund`)
      .send({ method: 'cash', note: 'Leaving town' });
    expect(res.body).toMatchObject({ amount: 50000, method: 'cash' });
    const plan = (
      await admin
        .post('/api/membership-plans')
        .send({ name: 'Silver', price: 19900, durationDays: 30, bookLimit: 2, finePerDay: 500 })
    ).body;
    const checkout = await m.agent
      .post('/api/member/payments')
      .send({ purpose: 'membership', planId: plan.id });
    expect(checkout.body.payment.amount).toBe(19900 + 50000); // plan + full deposit again
    await staff
      .post('/api/payments/counter')
      .send({ memberToken: m.token, method: 'cash', purpose: 'membership', planId: plan.id });
    const p = await runWithTenant(lib.id, () => MemberProfileModel.findById(profileId).lean());
    expect(p).toMatchObject({ depositBalance: 50000, membershipClosedAt: null });
  });

  it('only this library’s staff can act on its refunds; members cannot', async () => {
    const { m, profileId } = await setup(50000);
    await m.agent.post('/api/member/deposit-refund').send({});
    const other = await createLibrary('town');
    await createUser({ libraryId: other.id, role: 'libraryAdmin', email: 'owner@town.test' });
    const outsider = await signedInAgent(app, 'owner@town.test');
    expect((await outsider.get('/api/deposit-refunds')).body).toEqual([]);
    expect(
      (await outsider.post(`/api/deposit-refunds/${profileId}/approve`).send({ method: 'cash' }))
        .status,
    ).toBe(409);
    expect((await m.agent.get('/api/deposit-refunds')).status).toBe(403);
  });
});
