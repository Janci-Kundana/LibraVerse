import { Types } from 'mongoose';
import type { PlatformPlanCode, Role } from '@libraverse/shared';
import { env } from '../../config/env';
import { AppError } from '../../core/errors';
import { sendMail } from '../../core/mailer';
import { runAsSystem, runWithTenant } from '../../core/tenant';
import { recordAudit } from '../audit/service';
import { BranchModel } from '../branches/model';
import { DAY_MS, rupees } from '../circulation/rules';
import { LibraryModel } from '../libraries/model';
import { callGateway, gatewayFromCredentials, type Gateway } from '../payments/gateway';
import { verifyWebhookSignature, InvalidSignatureError } from '../payments/service';
import { transitionPayment, type PaymentLikeModel } from '../payments/stateMachine';
import { WebhookEventModel } from '../payments/webhookEventModel';
import { PlatformPlanModel } from '../platformPlans/model';
import { SubscriptionModel } from '../subscriptions/model';
import { UserModel } from '../users/model';
import { PlatformPaymentModel } from './model';

// FR-03 (SaaS billing), FR-06, FR-12, TC-10. Platform payments use the
// platform's own Razorpay account from env; library payments never touch it.

const WINDOW_MS = 15 * 60 * 1000;
const PERIOD_MS = 30 * DAY_MS;
const PP = PlatformPaymentModel as unknown as PaymentLikeModel;

type Actor = { id: string; role: Role };

export const billingAvailable = () =>
  Boolean(
    env.PLATFORM_RAZORPAY_KEY_ID &&
    env.PLATFORM_RAZORPAY_KEY_SECRET &&
    env.PLATFORM_RAZORPAY_WEBHOOK_SECRET,
  );

function platformGateway(): Gateway {
  if (!billingAvailable()) {
    throw new AppError(409, 'BILLING_NOT_CONFIGURED', 'Pro plan payments are not available yet');
  }
  return gatewayFromCredentials({
    keyId: env.PLATFORM_RAZORPAY_KEY_ID!,
    keySecret: env.PLATFORM_RAZORPAY_KEY_SECRET!,
  });
}

export interface PlatformCheckout {
  paymentId: string;
  orderId: string;
  keyId: string;
  amount: number;
  expiresAt: string;
  description: string;
}

/** A Pro payment request with its Razorpay order. System context. */
export function createPlatformPayment(
  libraryId: Types.ObjectId | string,
  purpose: 'registration' | 'upgrade',
) {
  return runAsSystem('billing:create-payment', async (): Promise<PlatformCheckout> => {
    const plan = await PlatformPlanModel.findOne({ code: 'pro', active: true }).lean();
    if (!plan || plan.monthlyPrice < 100)
      throw new AppError(409, 'PLAN_NOT_AVAILABLE', 'The Pro plan is not available');
    const gateway = platformGateway();
    const payment = await PlatformPaymentModel.create({
      billedLibraryId: new Types.ObjectId(libraryId),
      platformPlanId: plan._id,
      purpose,
      amount: plan.monthlyPrice,
      expiresAt: new Date(Date.now() + WINDOW_MS),
      history: [{ status: 'created', at: new Date(), source: purpose }],
    });
    try {
      const order = await callGateway(() =>
        gateway.createOrder({
          amount: plan.monthlyPrice,
          receipt: String(payment._id),
          notes: { platformPaymentId: String(payment._id), libraryId: String(libraryId) },
        }),
      );
      payment.razorpayOrderId = order.id;
      await payment.save();
    } catch (err) {
      await transitionPayment(
        payment._id,
        'failed',
        { source: 'system', note: 'order creation failed' },
        PP,
      );
      throw err;
    }
    return {
      paymentId: String(payment._id),
      orderId: payment.razorpayOrderId!,
      keyId: gateway.keyId,
      amount: plan.monthlyPrice,
      expiresAt: payment.expiresAt.toISOString(),
      description: `LibraVerse Pro: 1 month`,
    };
  });
}

async function planByCode(code: PlatformPlanCode) {
  const plan = await PlatformPlanModel.findOne({ code }).lean();
  if (!plan) throw new AppError(500, 'PLAN_MISSING', `Platform plan ${code} is missing`);
  return plan;
}

/** Puts the library on Pro for another month (from now, or from the current end). */
async function extendPro(libraryId: Types.ObjectId, now: Date) {
  const pro = await planByCode('pro');
  const library = await LibraryModel.findById(libraryId).select('status').lean();
  await runWithTenant(libraryId, async () => {
    const sub = await SubscriptionModel.findOne();
    if (!sub) return;
    const from =
      sub.currentPeriodEnd &&
      sub.currentPeriodEnd > now &&
      String(sub.platformPlanId) === String(pro._id)
        ? sub.currentPeriodEnd
        : now;
    sub.set({
      platformPlanId: pro._id,
      // A pending library's month starts at approval.
      currentPeriodEnd: library?.status === 'active' ? new Date(from.getTime() + PERIOD_MS) : null,
      status: library?.status === 'active' ? 'active' : 'pending',
    });
    await sub.save();
  });
}

/** /api/webhooks/razorpay/platform: verified with the platform webhook secret. */
export async function handlePlatformWebhook(
  raw: Buffer,
  signature: string | undefined,
  eventId: string | undefined,
) {
  if (
    !billingAvailable() ||
    !verifyWebhookSignature(raw, signature, env.PLATFORM_RAZORPAY_WEBHOOK_SECRET!)
  ) {
    throw new InvalidSignatureError();
  }
  return runAsSystem('webhook:platform', async () => {
    if (eventId) {
      try {
        await WebhookEventModel.create({ eventId, source: 'platform' });
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return 'duplicate delivery';
        throw err;
      }
    }
    const event = JSON.parse(raw.toString('utf8')) as {
      event: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
    };
    const entity = event.payload?.payment?.entity;
    if (!entity?.order_id || !entity.id) return `ignored ${event.event}`;
    const payment = await PlatformPaymentModel.findOne({ razorpayOrderId: entity.order_id });
    if (!payment) return 'unknown order';

    if (event.event === 'payment.failed') {
      if (payment.status === 'created' || payment.status === 'pending') {
        await transitionPayment(payment._id, 'failed', { source: 'webhook' }, PP);
      }
      return 'failed';
    }
    if (event.event !== 'payment.captured' && event.event !== 'order.paid')
      return `ignored ${event.event}`;
    if (entity.amount !== payment.amount) return 'amount mismatch';
    if (payment.status === 'success') return 'already success';

    const now = new Date();
    if (
      (payment.status === 'created' || payment.status === 'pending') &&
      now <= payment.expiresAt
    ) {
      const { changed } = await transitionPayment(
        payment._id,
        'success',
        { source: 'webhook', set: { razorpayPaymentId: entity.id, paidAt: now } },
        PP,
      );
      if (changed) {
        await extendPro(payment.billedLibraryId, now);
        await recordAudit({
          libraryId: payment.billedLibraryId,
          actor: null,
          action: 'subscription.paid',
          target: { type: 'platformPayment', id: payment._id },
          details: { amount: payment.amount, purpose: payment.purpose },
        });
      }
      return 'success';
    }
    // Late capture: refund, never activate.
    if (payment.status === 'created' || payment.status === 'pending') {
      await transitionPayment(payment._id, 'expired', { source: 'webhook' }, PP);
    }
    if (!payment.refund) {
      const refund = await callGateway(() =>
        platformGateway().refund(entity.id!, entity.amount!, { reason: 'late capture' }),
      );
      await PlatformPaymentModel.updateOne(
        { _id: payment._id },
        {
          $set: {
            refund: {
              amount: entity.amount,
              reason: 'Paid after the request expired',
              razorpayRefundId: refund.id,
              refundedAt: now,
            },
          },
        },
      );
    }
    return 'late capture refunded';
  });
}

/** Called when the Super Admin approves: a paid Pro month starts now. System context. */
export async function onLibraryApproved(libraryId: Types.ObjectId) {
  const pro = await planByCode('pro');
  await runWithTenant(libraryId, async () => {
    const sub = await SubscriptionModel.findOne();
    if (!sub) return;
    const isPro = String(sub.platformPlanId) === String(pro._id);
    sub.set({
      status: 'active',
      currentPeriodEnd: isPro ? new Date(Date.now() + PERIOD_MS) : null,
    });
    await sub.save();
  });
}

/** TC-10: rejecting a library that paid for Pro refunds it; it stays inactive. */
export async function onLibraryRejected(libraryId: Types.ObjectId, actor: Actor, reason?: string) {
  const paid = await PlatformPaymentModel.find({
    billedLibraryId: libraryId,
    status: 'success',
    refund: null,
  });
  for (const p of paid) {
    const refund = await callGateway(() =>
      platformGateway().refund(p.razorpayPaymentId!, p.amount, {
        reason: 'library registration rejected',
      }),
    );
    p.refund = {
      amount: p.amount,
      reason: reason ?? 'Registration rejected',
      razorpayRefundId: refund.id,
      refundedAt: new Date(),
    };
    await p.save();
    await recordAudit({
      libraryId,
      actor,
      action: 'subscription.refunded',
      target: { type: 'platformPayment', id: p._id },
      details: { amount: p.amount, razorpayRefundId: refund.id },
    });
  }
  const free = await planByCode('free');
  await runWithTenant(libraryId, () =>
    SubscriptionModel.updateOne(
      {},
      { $set: { status: 'cancelled', platformPlanId: free._id, currentPeriodEnd: null } },
    ),
  );
  return paid.reduce((s, p) => s + p.amount, 0);
}

async function usage() {
  const [members, branches] = await Promise.all([
    UserModel.countDocuments({ role: 'member', status: { $ne: 'disabled' } }),
    BranchModel.countDocuments(),
  ]);
  return { members, branches };
}

/** Tenant context of the library admin. */
export async function getSubscription(libraryId: string) {
  const sub = await SubscriptionModel.findOne().lean();
  const plan = sub ? await PlatformPlanModel.findById(sub.platformPlanId).lean() : null;
  const plans = await PlatformPlanModel.find({ active: true }).sort({ monthlyPrice: 1 }).lean();
  const invoices = await runAsSystem('billing:own-invoices', () =>
    PlatformPaymentModel.find({
      billedLibraryId: new Types.ObjectId(libraryId),
      status: { $in: ['success'] },
    })
      .sort({ createdAt: -1 })
      .lean(),
  );
  return {
    planCode: (plan?.code ?? 'free') as PlatformPlanCode,
    planName: plan?.name ?? 'Free',
    status: sub?.status ?? 'pending',
    currentPeriodEnd: sub?.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
    limits: { members: plan?.memberLimit ?? null, branches: plan?.branchLimit ?? null },
    usage: await usage(),
    billingAvailable: billingAvailable(),
    plans: plans.map((p) => ({
      code: p.code as PlatformPlanCode,
      name: p.name,
      monthlyPrice: p.monthlyPrice,
      memberLimit: p.memberLimit ?? null,
      branchLimit: p.branchLimit ?? null,
    })),
    invoices: invoices.map((i) => ({
      id: String(i._id),
      amount: i.amount,
      paidAt: i.paidAt ? i.paidAt.toISOString() : null,
      purpose: i.purpose,
      refunded: i.refund != null,
    })),
  };
}

/** FR-12: downgrade to Free, only if the library fits Free's limits. */
export async function downgrade(libraryId: string, actor: Actor) {
  const free = await planByCode('free');
  const u = await usage();
  if (free.branchLimit != null && u.branches > free.branchLimit) {
    throw new AppError(
      409,
      'OVER_LIMIT',
      `Free allows ${free.branchLimit} branch. Remove ${u.branches - free.branchLimit} first.`,
    );
  }
  if (free.memberLimit != null && u.members > free.memberLimit) {
    throw new AppError(
      409,
      'OVER_LIMIT',
      `Free allows ${free.memberLimit} members; you have ${u.members}.`,
    );
  }
  await SubscriptionModel.updateOne(
    {},
    { $set: { platformPlanId: free._id, currentPeriodEnd: null, status: 'active' } },
  );
  await recordAudit({
    libraryId,
    actor,
    action: 'subscription.downgraded',
    target: { type: 'library', id: libraryId },
    details: {},
  });
  return getSubscription(libraryId);
}

/** The current plan's limits, for enforcement. Tenant context. */
export async function currentLimits() {
  const sub = await SubscriptionModel.findOne().select('platformPlanId').lean();
  const plan = sub
    ? await PlatformPlanModel.findById(sub.platformPlanId).lean()
    : await PlatformPlanModel.findOne({ code: 'free' }).lean();
  return {
    name: plan?.name ?? 'Free',
    memberLimit: plan?.memberLimit ?? null,
    branchLimit: plan?.branchLimit ?? null,
  };
}

/** Cron: an unpaid Pro month has ended, so the library drops to Free. */
export async function expireProSubscriptions(libraryId: string, now = new Date()) {
  const free = await planByCode('free');
  const pro = await planByCode('pro');
  const lapsed = await SubscriptionModel.findOneAndUpdate(
    { platformPlanId: pro._id, currentPeriodEnd: { $lt: now } },
    { $set: { platformPlanId: free._id, currentPeriodEnd: null } },
  );
  if (!lapsed) return 0;
  const library = await LibraryModel.findById(libraryId).select('name contactEmail').lean();
  if (library) {
    await sendMail({
      to: library.contactEmail,
      subject: `${library.name} is back on the Free plan`,
      text: `Your LibraVerse Pro month ended and was not renewed. Renew any time from Subscription in your dashboard (${rupees(pro.monthlyPrice)}/month).`,
    });
  }
  return 1;
}

/** Cron, system context: platform payment requests past their window. */
export async function expirePlatformPayments(now = new Date()) {
  return runAsSystem('cron:platform-payments', async () => {
    const stale = await PlatformPaymentModel.find({
      status: { $in: ['created', 'pending'] },
      expiresAt: { $lt: now },
    });
    for (const p of stale)
      await transitionPayment(p._id, 'expired', { source: 'cron' }, PP).catch(() => {});
    return stale.length;
  });
}

/** Super Admin: Pro payment state for the library list. System context. */
export async function proPaymentStatus(libraryIds: Types.ObjectId[]) {
  const pays = await PlatformPaymentModel.find({
    billedLibraryId: { $in: libraryIds },
    status: 'success',
  }).lean();
  const out = new Map<string, 'paid' | 'refunded'>();
  for (const p of pays) out.set(String(p.billedLibraryId), p.refund ? 'refunded' : 'paid');
  return out;
}
