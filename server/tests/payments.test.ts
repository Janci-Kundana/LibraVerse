import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runAsSystem, runWithTenant } from '../src/core/tenant';
import { expireUnpaid } from '../src/jobs/payments';
import { AuditLogModel } from '../src/modules/audit/model';
import { LibraryModel } from '../src/modules/libraries/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { MembershipPlanModel } from '../src/modules/membershipPlans/model';
import { setGatewayFactory, type Gateway } from '../src/modules/payments/gateway';
import { PaymentModel } from '../src/modules/payments/model';
import { transitionPayment } from '../src/modules/payments/stateMachine';
import { LoanModel } from '../src/modules/loans/model';
import { UserModel } from '../src/modules/users/model';
import { attachRealtime, closeRealtime } from '../src/realtime/io';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();
const WEBHOOK_SECRET = 'whsec_test_1234567890';

let orders = 0;
const refunds: { paymentId: string; amount: number }[] = [];
const fakeGateway: Gateway = {
  keyId: 'rzp_test_abcdefgh',
  async createOrder() {
    return { id: `order_${++orders}` };
  },
  async refund(paymentId, amount) {
    refunds.push({ paymentId, amount });
    return { id: `rfnd_${refunds.length}` };
  },
};

beforeAll(() => setGatewayFactory(() => fakeGateway));
afterAll(() => setGatewayFactory());
beforeEach(() => {
  refunds.length = 0;
});

async function setup() {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  const admin = await signedInAgent(app, 'owner@city.test');
  const staff = await signedInAgent(app, 'staff@city.test');
  const keys = await admin.put('/api/library/payment-settings').send({
    keyId: 'rzp_test_abcdefgh',
    keySecret: 'secret_key_123',
    webhookSecret: WEBHOOK_SECRET,
  });
  expect(keys.status).toBe(200);
  const plan = (
    await admin.post('/api/membership-plans').send({
      name: 'Gold',
      price: 49900,
      durationDays: 90,
      bookLimit: 4,
      finePerDay: 500,
      tier: 'gold',
    })
  ).body;
  // A verified member without a plan yet.
  const m = await activeMember(app, lib.id, 'reader@city.test');
  await runWithTenant(lib.id, () =>
    MemberProfileModel.updateOne(
      { _id: m.profile._id },
      { $set: { planId: null, validTill: null } },
    ),
  );
  return { lib, admin, staff, plan, m };
}

function signedWebhook(
  libraryId: string,
  body: object,
  secret = WEBHOOK_SECRET,
  eventId = `evt_${Math.random()}`,
) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', secret).update(raw).digest('hex');
  return request(app)
    .post(`/api/webhooks/razorpay/${libraryId}`)
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', sig)
    .set('x-razorpay-event-id', eventId)
    .send(raw);
}

const captured = (orderId: string, amount: number, id = 'pay_1') => ({
  event: 'payment.captured',
  payload: { payment: { entity: { id, order_id: orderId, amount, status: 'captured' } } },
});

async function paymentByOrder(libraryId: string, orderId: string) {
  return runWithTenant(libraryId, () => PaymentModel.findOne({ razorpayOrderId: orderId }).lean());
}

describe('Razorpay keys (rule 3)', () => {
  it('stores secrets encrypted, never returns them, and only accepts test keys', async () => {
    const { lib, admin } = await setup();
    const res = await admin.get('/api/library/payment-settings');
    expect(res.body).toEqual({
      keyId: 'rzp_test_abcdefgh',
      keySecretSet: true,
      webhookSecretSet: true,
      webhookUrl: `http://localhost:5173/api/webhooks/razorpay/${lib.id}`,
    });
    expect(JSON.stringify(res.body)).not.toContain('secret_key_123');

    const stored = await runAsSystem('test', () =>
      LibraryModel.findById(lib.id).select('+razorpayKeySecret +razorpayWebhookSecret').lean(),
    );
    expect(JSON.stringify(stored)).not.toContain('secret_key_123');
    expect(stored?.razorpayKeySecret).toMatchObject({
      iv: expect.any(String),
      tag: expect.any(String),
    });

    const audit = await runWithTenant(lib.id, () =>
      AuditLogModel.findOne({ action: 'library.paymentKeysUpdated' }).lean(),
    );
    expect(JSON.stringify(audit)).not.toContain('secret_key_123');

    expect(
      (await admin.put('/api/library/payment-settings').send({ keyId: 'rzp_live_abcdefgh' }))
        .status,
    ).toBe(400);
  });
});

describe('online membership payment', () => {
  it('TC-01: only the verified webhook activates the membership, emails a receipt, and pushes live to both screens', async () => {
    const { lib, plan, m } = await setup();
    const checkout = await m.agent
      .post('/api/member/payments')
      .send({ purpose: 'membership', planId: plan.id });
    expect(checkout.status).toBe(201);
    expect(checkout.body).toMatchObject({
      keyId: 'rzp_test_abcdefgh',
      payment: { amount: 49900, status: 'created' },
    });
    const { orderId } = checkout.body;
    const paymentId = checkout.body.payment.id;
    await m.agent.post(`/api/member/payments/${paymentId}/opened`);
    expect((await m.agent.get(`/api/member/payments/${paymentId}`)).body.status).toBe('pending');

    // Live sockets for the member and a staff member.
    const server = http.createServer(app);
    attachRealtime(server);
    await new Promise<void>((r) => server.listen(0, r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookieOf = async (email: string, password = 'Readers4ever') => {
      const res = await request(app).post('/api/auth/login').send({ email, password });
      return (res.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
    };
    const sockets: Socket[] = [];
    const open = async (cookie: string) => {
      const s = connect(url, {
        extraHeaders: { cookie },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(s);
      await new Promise<void>((r, j) => {
        s.on('connect', () => r());
        s.on('connect_error', j);
      });
      return s;
    };
    try {
      const memberSocket = await open(await cookieOf('reader@city.test'));
      const staffSocket = await open(await cookieOf('staff@city.test'));
      const joined = await new Promise<{ ok: boolean }>((r) =>
        memberSocket.emit('payment:join', paymentId, r),
      );
      expect(joined.ok).toBe(true);
      const events = Promise.all(
        [memberSocket, staffSocket].map(
          (s) => new Promise<{ status: string }>((r) => s.once('payment:updated', r)),
        ),
      );

      const hook = await signedWebhook(lib.id, captured(orderId, 49900));
      expect(hook.status).toBe(200);
      const [toMember, toStaff] = await events;
      expect(toMember).toMatchObject({ status: 'success', paymentId });
      expect(toStaff).toMatchObject({ status: 'success', memberName: 'member reader@city.test' });
    } finally {
      sockets.forEach((s) => s.close());
      closeRealtime();
      await new Promise((r) => server.close(r));
    }

    const profile = await runWithTenant(lib.id, () =>
      MemberProfileModel.findById(m.profile._id).lean(),
    );
    expect(profile).toMatchObject({ cardTier: 'gold' });
    const days = (profile!.validTill!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    const mail = testOutbox.find((x) => x.subject.startsWith('Receipt'));
    expect(mail?.attachments?.[0]?.filename).toMatch(/^receipt-CITY-\d{8}-\w{6}\.pdf$/);
    const pdf = await m.agent.get(`/api/member/payments/${paymentId}/receipt.pdf`).buffer(true);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // A retried delivery of the same event is ignored; a second capture changes nothing.
    await signedWebhook(lib.id, captured(orderId, 49900), WEBHOOK_SECRET, 'evt_same');
    expect(
      (await signedWebhook(lib.id, captured(orderId, 49900), WEBHOOK_SECRET, 'evt_same')).body
        .result,
    ).toBe('duplicate delivery');
  });

  it('TC-03: a fake success without a valid signature is rejected; the payment stays pending', async () => {
    const { lib, plan, m } = await setup();
    const { orderId, payment } = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;
    await m.agent.post(`/api/member/payments/${payment.id}/opened`);

    const forged = await signedWebhook(lib.id, captured(orderId, 49900), 'wrong-secret-xyz');
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('INVALID_SIGNATURE');
    const unsigned = await request(app)
      .post(`/api/webhooks/razorpay/${lib.id}`)
      .set('Content-Type', 'application/json')
      .send(captured(orderId, 49900));
    expect(unsigned.status).toBe(400);

    expect((await paymentByOrder(lib.id, orderId))?.status).toBe('pending');
    const profile = await runWithTenant(lib.id, () =>
      MemberProfileModel.findById(m.profile._id).lean(),
    );
    expect(profile?.planId).toBeNull();
  });

  it('TC-02: an unpaid request expires and activates nothing; a late capture is auto-refunded', async () => {
    const { lib, plan, m } = await setup();
    const { orderId } = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;

    expect(await expireUnpaid(lib.id, new Date(Date.now() + 11 * 60_000))).toBe(1);
    expect((await paymentByOrder(lib.id, orderId))?.status).toBe('expired');

    const late = await signedWebhook(lib.id, captured(orderId, 49900, 'pay_late'));
    expect(late.body.result).toBe('late capture refunded');
    expect(refunds).toEqual([{ paymentId: 'pay_late', amount: 49900 }]);
    const p = await paymentByOrder(lib.id, orderId);
    expect(p).toMatchObject({ status: 'expired', lateCapture: { razorpayPaymentId: 'pay_late' } });
    const profile = await runWithTenant(lib.id, () =>
      MemberProfileModel.findById(m.profile._id).lean(),
    );
    expect(profile?.planId).toBeNull();
  });

  it('a failed payment is terminal; an amount mismatch never activates', async () => {
    const { lib, plan, m } = await setup();
    const a = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;
    await signedWebhook(lib.id, {
      event: 'payment.failed',
      payload: {
        payment: {
          entity: {
            id: 'pay_f',
            order_id: a.orderId,
            amount: 49900,
            error_description: 'Card declined',
          },
        },
      },
    });
    expect(await paymentByOrder(lib.id, a.orderId)).toMatchObject({
      status: 'failed',
      failureReason: 'Card declined',
    });
    await signedWebhook(lib.id, captured(a.orderId, 49900, 'pay_x'));
    expect((await paymentByOrder(lib.id, a.orderId))?.status).toBe('failed');

    const b = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;
    expect((await signedWebhook(lib.id, captured(b.orderId, 100))).body.result).toBe(
      'amount mismatch',
    );
    expect((await paymentByOrder(lib.id, b.orderId))?.status).toBe('created');
  });

  it('applies a coupon', async () => {
    const { admin, plan, m } = await setup();
    await admin
      .post('/api/coupons')
      .send({ code: 'HALF', discountPercent: 50, validTill: '2099-01-01' });
    const res = await m.agent
      .post('/api/member/payments')
      .send({ purpose: 'membership', planId: plan.id, couponCode: 'half' });
    expect(res.body.payment).toMatchObject({ amount: 24950, discount: 24950, couponCode: 'HALF' });
    expect(
      (
        await m.agent
          .post('/api/member/payments')
          .send({ purpose: 'membership', planId: plan.id, couponCode: 'NOPE' })
      ).status,
    ).toBe(400);
  });

  it('TC-08: a member without an approved ID cannot buy a plan', async () => {
    const { lib, plan } = await setup();
    await createUser({ libraryId: lib.id, role: 'member', email: 'new@city.test' });
    await runWithTenant(lib.id, async () => {
      const u = await UserModel.findOne({ email: 'new@city.test' });
      await MemberProfileModel.create({
        userId: u!._id,
        idProofKey: 'k',
        termsAcceptedAt: new Date(),
      });
    });
    const newcomer = await signedInAgent(app, 'new@city.test');
    const res = await newcomer
      .post('/api/member/payments')
      .send({ purpose: 'membership', planId: plan.id });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/^Verification pending/);
  });
});

describe('counter payments (FR-17)', () => {
  it('TC-04: cash activates the membership, makes a receipt, and audits the librarian by name', async () => {
    const { lib, staff, plan, m } = await setup();
    const res = await staff
      .post('/api/payments/counter')
      .send({ memberToken: m.token, method: 'cash', purpose: 'membership', planId: plan.id });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({
      status: 'success',
      method: 'cash',
      collectedByName: 'librarian staff@city.test',
    });
    expect(res.body.payment.receiptNo).toMatch(/^CITY-/);
    const profile = await runWithTenant(lib.id, () =>
      MemberProfileModel.findById(m.profile._id).lean(),
    );
    expect(profile?.planId?.toString()).toBe(plan.id);
    const audit = await runWithTenant(lib.id, () =>
      AuditLogModel.findOne({ action: 'payment.cash' }).lean(),
    );
    expect(audit).toMatchObject({
      actorRole: 'librarian',
      details: { amount: 49900, collectedBy: 'librarian staff@city.test' },
    });
    expect((await staff.get(`/api/payments/${res.body.payment.id}/receipt.pdf`)).status).toBe(200);
  });

  it('UPI QR: a public pay link that opens the same checkout, confirmed by webhook', async () => {
    const { lib, staff, plan, m } = await setup();
    const res = await staff
      .post('/api/payments/counter')
      .send({ memberToken: m.token, method: 'counterUpi', purpose: 'membership', planId: plan.id });
    const token = res.body.payUrl.split('/pay/')[1];
    const pub = await request(app).get(`/api/pay/${token}`);
    expect(pub.body).toMatchObject({
      libraryName: 'Library city',
      amount: 49900,
      status: 'created',
      keyId: 'rzp_test_abcdefgh',
    });
    await request(app).post(`/api/pay/${token}/opened`);
    await signedWebhook(lib.id, captured(pub.body.orderId, 49900));
    expect((await request(app).get(`/api/pay/${token}`)).body.status).toBe('success');
    expect((await request(app).get('/api/pay/not-a-real-token-at-all')).status).toBe(404);
  });

  it('fine payment clears dues so the member can borrow again', async () => {
    const { lib, staff, m } = await setup();
    await runWithTenant(lib.id, async () => {
      const plan = await MembershipPlanModel.findOne({ name: 'Gold' });
      await MemberProfileModel.updateOne(
        { _id: m.profile._id },
        { planId: plan!._id, validTill: new Date(Date.now() + 9e9) },
      );
      await LoanModel.create({
        copyId: m.profile._id,
        bookId: m.profile._id,
        memberId: m.user._id,
        issuedBy: m.user._id,
        issuedAt: new Date(),
        dueAt: new Date(),
        finePerDay: 500,
        status: 'returned',
        returnedAt: new Date(),
        fineAmount: 1500,
      });
    });
    expect(
      (await staff.post('/api/circulation/scan-member').send({ memberToken: m.token })).body
        .pendingDues,
    ).toBe(1500);
    const paid = await staff
      .post('/api/payments/counter')
      .send({ memberToken: m.token, method: 'cash', purpose: 'fine' });
    expect(paid.body.payment).toMatchObject({ amount: 1500, purpose: 'fine', status: 'success' });
    expect(
      (await staff.post('/api/circulation/scan-member').send({ memberToken: m.token })).body,
    ).toMatchObject({ pendingDues: 0, canBorrow: true });
  });
});

describe('refunds (FR-11)', () => {
  it('admin refunds once through Razorpay; librarians cannot', async () => {
    const { lib, admin, staff, plan, m } = await setup();
    const { orderId, payment } = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;
    await signedWebhook(lib.id, captured(orderId, 49900, 'pay_r'));
    expect(
      (await staff.post(`/api/payments/${payment.id}/refund`).send({ reason: 'Duplicate' })).status,
    ).toBe(403);
    const res = await admin
      .post(`/api/payments/${payment.id}/refund`)
      .send({ amount: 10000, reason: 'Partial goodwill' });
    expect(res.body.refund).toMatchObject({ amount: 10000, reason: 'Partial goodwill' });
    expect(refunds).toEqual([{ paymentId: 'pay_r', amount: 10000 }]);
    expect(
      (await admin.post(`/api/payments/${payment.id}/refund`).send({ reason: 'Again' })).status,
    ).toBe(409);
    const audit = await runWithTenant(lib.id, () =>
      AuditLogModel.findOne({ action: 'payment.refunded' }).lean(),
    );
    expect(audit).toMatchObject({ actorRole: 'libraryAdmin', details: { amount: 10000 } });
  });

  it('the state machine never leaves a terminal state', async () => {
    const { lib, plan, m } = await setup();
    const { payment } = (
      await m.agent.post('/api/member/payments').send({ purpose: 'membership', planId: plan.id })
    ).body;
    await runWithTenant(lib.id, async () => {
      await transitionPayment(payment.id, 'expired', { source: 'test' });
      await expect(
        transitionPayment(payment.id, 'success', { source: 'test' }),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
      expect((await transitionPayment(payment.id, 'expired', { source: 'test' })).changed).toBe(
        false,
      );
    });
  });
});
