import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { testOutbox } from '../src/core/mailer';
import { runAsSystem, runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { PlatformPaymentModel } from '../src/modules/billing/model';
import { BookModel } from '../src/modules/books/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { NotificationModel } from '../src/modules/notifications/model';
import { setGatewayFactory, type Gateway } from '../src/modules/payments/gateway';
import { PlatformPlanModel } from '../src/modules/platformPlans/model';
import { ensureDefaultPlans } from '../src/modules/platformPlans/service';
import { SubscriptionModel } from '../src/modules/subscriptions/model';
import {
  PNG_DATA_URL,
  activeMember,
  createLibrary,
  createUser,
  lastLinkTokenSentTo,
  signedInAgent,
} from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();
const refunds: { paymentId: string; amount: number }[] = [];
let orders = 0;
const gateway: Gateway = {
  keyId: 'rzp_test_platform1',
  createOrder: async () => ({ id: `order_p${++orders}` }),
  refund: async (paymentId, amount) => {
    refunds.push({ paymentId, amount });
    return { id: `rfnd_p${refunds.length}` };
  },
};
beforeAll(() => setGatewayFactory(() => gateway));
afterAll(() => setGatewayFactory());
beforeEach(async () => {
  refunds.length = 0;
  await runAsSystem('test', ensureDefaultPlans);
});

function platformWebhook(orderId: string, amount: number, id = 'pay_p1') {
  const raw = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id, order_id: orderId, amount } } },
  });
  return request(app)
    .post('/api/webhooks/razorpay/platform')
    .set('Content-Type', 'application/json')
    .set(
      'x-razorpay-signature',
      createHmac('sha256', 'platform_webhook_secret').update(raw).digest('hex'),
    )
    .set('x-razorpay-event-id', `evt_${Math.random()}`)
    .send(raw);
}

async function superAdmin() {
  await createUser({ libraryId: null, role: 'superAdmin', email: 'root@platform.test' });
  return signedInAgent(app, 'root@platform.test');
}

const registration = {
  libraryName: 'Pro Reads',
  ownerName: 'Asha',
  ownerEmail: 'asha@pro.test',
  planCode: 'pro',
};

describe('Pro registration and SaaS billing', () => {
  it('TC-10: rejecting a library that paid for Pro keeps it inactive and refunds the payment', async () => {
    const reg = await request(app).post('/api/libraries/register').send(registration);
    expect(reg.status).toBe(201);
    expect(reg.body.checkout).toMatchObject({ keyId: 'rzp_test_platform1', amount: 99900 });
    expect((await platformWebhook(reg.body.checkout.orderId, 99900)).body.result).toBe('success');

    const admin = await superAdmin();
    const list = await admin.get('/api/admin/libraries?status=pending');
    expect(list.body[0]).toMatchObject({ planCode: 'pro', proPayment: 'paid' });

    const res = await admin
      .post(`/api/admin/libraries/${reg.body.id}/reject`)
      .send({ reason: 'Could not verify' });
    expect(res.body.status).toBe('rejected');
    expect(refunds).toEqual([{ paymentId: 'pay_p1', amount: 99900 }]);
    expect(testOutbox.at(-1)?.text).toMatch(/Pro payment of ₹999 has been refunded/);
    const pp = await runAsSystem('test', () => PlatformPaymentModel.findOne().lean());
    expect(pp?.refund).toMatchObject({ amount: 99900 });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'asha@pro.test', password: 'x' });
    expect(login.status).toBe(401);
    const audit = await runWithTenant(reg.body.id, () =>
      AuditLogModel.findOne({ action: 'subscription.refunded' }).lean(),
    );
    expect(audit).toMatchObject({ actorRole: 'superAdmin', details: { amount: 99900 } });
  });

  it('approving a paid Pro library starts a 30-day Pro month', async () => {
    const reg = await request(app).post('/api/libraries/register').send(registration);
    await platformWebhook(reg.body.checkout.orderId, 99900);
    const admin = await superAdmin();
    await admin.post(`/api/admin/libraries/${reg.body.id}/approve`).send({});
    const sub = await runWithTenant(reg.body.id, () => SubscriptionModel.findOne().lean());
    expect(sub?.status).toBe('active');
    expect((sub!.currentPeriodEnd!.getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 0);
    expect(lastLinkTokenSentTo('asha@pro.test')).toBeTruthy();
  });

  it('FR-12: an active Free library upgrades via the platform webhook and can downgrade within limits', async () => {
    const lib = await createLibrary('city', 'active', { plan: 'free' });
    await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
    const owner = await signedInAgent(app, 'owner@city.test');
    const up = await owner.post('/api/library/subscription/upgrade');
    expect(up.status).toBe(201);
    await platformWebhook(up.body.orderId, 99900, 'pay_up');
    let sub = (await owner.get('/api/library/subscription')).body;
    expect(sub).toMatchObject({ planCode: 'pro', status: 'active', limits: { branches: 10 } });
    expect(sub.invoices).toHaveLength(1);

    expect((await owner.post('/api/branches').send({ name: 'North' })).status).toBe(201);
    const blocked = await owner.post('/api/library/subscription/downgrade');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Free allows 1 branch/);
    const north = (await owner.get('/api/branches')).body.find(
      (b: { name: string }) => b.name === 'North',
    );
    await owner.delete(`/api/branches/${north.id}`);
    sub = (await owner.post('/api/library/subscription/downgrade')).body;
    expect(sub.planCode).toBe('free');
  });

  it('enforces the member limit at sign-up', async () => {
    await runAsSystem('test', () =>
      PlatformPlanModel.updateOne({ code: 'free' }, { memberLimit: 1 }),
    );
    await createLibrary('city', 'active', { plan: 'free' });
    const join = (email: string) =>
      request(app).post('/api/members/join').send({
        librarySlug: 'city',
        name: 'Reader One',
        email,
        password: 'Reader-pass1',
        idProof: PNG_DATA_URL,
        acceptTerms: true,
      });
    expect((await join('a@x.test')).status).toBe(201);
    const second = await join('b@x.test');
    expect(second.status).toBe(403);
    expect(second.body.error.code).toBe('PLAN_LIMIT');
  });

  it('FR-06: the Super Admin edits plan prices and limits; others cannot', async () => {
    const admin = await superAdmin();
    const plans = (await admin.get('/api/admin/plans')).body;
    const pro = plans.find((p: { code: string }) => p.code === 'pro');
    const res = await admin
      .put(`/api/admin/plans/${pro.id}`)
      .send({
        name: 'Pro',
        monthlyPrice: 149900,
        memberLimit: null,
        branchLimit: 20,
        active: true,
      });
    expect(res.body).toMatchObject({ monthlyPrice: 149900, branchLimit: 20 });
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'libraryAdmin', email: 'owner@city.test' });
    expect(
      (await (await signedInAgent(app, 'owner@city.test')).get('/api/admin/plans')).status,
    ).toBe(403);
  });

  it('a forged platform webhook is rejected', async () => {
    const res = await request(app)
      .post('/api/webhooks/razorpay/platform')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'f'.repeat(64))
      .send('{}');
    expect(res.status).toBe(400);
  });
});

describe('donations (FR-03, TC-11)', () => {
  it('a visitor offers a book; the librarian accepts and catalogues it with a "Donated by" credit', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');

    const offer = await request(app).post('/api/public/libraries/city/donations').send({
      donorName: 'Ravi Kumar',
      donorEmail: 'ravi@x.test',
      title: 'The Guide',
      author: 'R. K. Narayan',
      condition: 'good',
    });
    expect(offer.status).toBe(201);
    expect(testOutbox.at(-1)?.to).toBe('ravi@x.test');

    expect((await staff.post(`/api/donations/${offer.body.id}/accept`).send({})).body.status).toBe(
      'accepted',
    );
    const cat = await staff
      .post(`/api/donations/${offer.body.id}/catalogue`)
      .send({ category: 'Fiction', copies: { count: 1, branchId: String(lib.branch._id) } });
    expect(cat.status).toBe(201);
    const book = await runWithTenant(lib.id, () => BookModel.findById(cat.body.bookId).lean());
    expect(book).toMatchObject({ title: 'The Guide', donatedBy: 'Ravi Kumar' });
    expect((await staff.get(`/api/books/${cat.body.bookId}`)).body).toMatchObject({
      donatedBy: 'Ravi Kumar',
      copies: { total: 1 },
    });
    expect(testOutbox.at(-1)?.subject).toBe('"The Guide" is now on the shelves at Library city');
    expect((await staff.post(`/api/donations/${offer.body.id}/decline`).send({})).status).toBe(409);
  });

  it('a member donor earns the Contributor badge; anonymous donors are credited as Anonymous', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const offer = await m.agent.post('/api/public/libraries/city/donations').send({
      donorName: 'Reader',
      donorEmail: 'reader@city.test',
      title: 'Malgudi Days',
      condition: 'fair',
      anonymous: true,
    });
    expect(offer.body.isMember).toBe(true);
    await staff.post(`/api/donations/${offer.body.id}/accept`).send({});
    const cat = await staff
      .post(`/api/donations/${offer.body.id}/catalogue`)
      .send({ copies: { count: 1, branchId: String(lib.branch._id) } });
    const book = await runWithTenant(lib.id, () => BookModel.findById(cat.body.bookId).lean());
    expect(book?.donatedBy).toBe('Anonymous');
    const profile = await runWithTenant(lib.id, () =>
      MemberProfileModel.findById(m.profile._id).lean(),
    );
    expect(profile?.badges).toContain('contributor');
  });
});

describe('notification centre and events', () => {
  it('notices land in the in-app centre and can be marked read', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');
    const m = await activeMember(app, lib.id, 'reader@city.test');

    const ev = await staff
      .post('/api/events')
      .send({
        kind: 'announcement',
        title: 'Closed on Monday',
        description: 'Holiday',
        notifyMembers: true,
      });
    expect(ev.status).toBe(201);
    const inbox = await m.agent.get('/api/notifications');
    expect(inbox.body).toMatchObject({
      unread: 1,
      items: [{ title: 'Closed on Monday', read: false }],
    });
    await m.agent.post('/api/notifications/read').send({});
    expect((await m.agent.get('/api/notifications')).body.unread).toBe(0);

    const board = await m.agent.get('/api/member/events');
    expect(board.body.map((e: { title: string }) => e.title)).toEqual(['Closed on Monday']);
    expect(await runWithTenant(lib.id, () => NotificationModel.countDocuments())).toBe(1);
    expect((await m.agent.post('/api/events').send({ kind: 'event', title: 'Nope' })).status).toBe(
      403,
    );
  });
});
