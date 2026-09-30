import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { Types, type HydratedDocument } from 'mongoose';
import type {
  CheckoutDto,
  PaymentDto,
  PaymentPurpose,
  PublicPayDto,
  Role,
} from '@libraverse/shared';
import { env } from '../../config/env';
import { decryptSecret, type EncryptedValue } from '../../core/crypto';
import { AppError } from '../../core/errors';
import { notFound, parseId } from '../../core/ids';
import { sendMail } from '../../core/mailer';
import { runAsSystem, runWithTenant } from '../../core/tenant';
import { emitPaymentUpdated } from '../../realtime/io';
import { recordAudit } from '../audit/service';
import { verifyCardToken } from '../card/token';
import { rupees } from '../circulation/rules';
import { findUsableCoupon } from '../coupons/service';
import { closeCycleIfPaid, collectDeposit, depositShortfall } from '../dues/service';
import { LibraryModel } from '../libraries/model';
import { LoanModel } from '../loans/model';
import { MemberProfileModel } from '../members/model';
import { MembershipPlanModel } from '../membershipPlans/model';
import { applyDuePlanChanges, applyMembership, assertPlanPurchasable } from '../members/planChange';
import { UserModel } from '../users/model';
import { callGateway, libraryGateway } from './gateway';
import { PaymentModel, type Payment } from './model';
import { receiptPdf } from './receipt';
import { transitionPayment } from './stateMachine';
import { WebhookEventModel } from './webhookEventModel';

// FR-11/17/20/23/26/27. Tenant context unless noted. Money in paise.

export const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

type Actor = { id: string; role: Role };
type PaymentDoc = Payment & { _id: Types.ObjectId; createdAt: Date };

// ---------------------------------------------------------------- DTOs

export async function toPaymentDtos(list: PaymentDoc[]): Promise<PaymentDto[]> {
  const userIds = [
    ...list.map((p) => p.memberId),
    ...list.map((p) => p.collectedBy).filter(Boolean),
  ];
  const [users, plans] = await Promise.all([
    UserModel.find({ _id: { $in: userIds } })
      .select('name')
      .lean(),
    MembershipPlanModel.find({ _id: { $in: list.map((p) => p.planId).filter(Boolean) } })
      .select('name')
      .lean(),
  ]);
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  const planName = new Map(plans.map((p) => [String(p._id), p.name]));
  return list.map((p) => ({
    id: String(p._id),
    memberId: String(p.memberId),
    memberName: name.get(String(p.memberId)) ?? 'Member',
    purpose: p.purpose,
    amount: p.amount,
    discount: p.discount,
    couponCode: p.couponCode ?? null,
    planName: p.planId ? (planName.get(String(p.planId)) ?? null) : null,
    method: p.method,
    status: p.status,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    receiptNo: p.receiptNo ?? null,
    collectedByName: p.collectedBy ? (name.get(String(p.collectedBy)) ?? null) : null,
    refund: p.refund
      ? {
          amount: p.refund.amount,
          reason: p.refund.reason,
          refundedAt: p.refund.refundedAt.toISOString(),
        }
      : null,
    lateCaptureRefunded: p.lateCapture != null,
  }));
}

const toDto = async (p: PaymentDoc) => (await toPaymentDtos([p]))[0]!;

function describe(p: { purpose: PaymentPurpose }, planName: string | null) {
  return p.purpose === 'membership'
    ? `Membership: ${planName ?? 'plan'}`
    : 'Library fines and charges';
}

// ---------------------------------------------------------------- creating requests

interface Charge {
  purpose: PaymentPurpose;
  amount: number;
  discount: number;
  couponCode: string | null;
  planId: Types.ObjectId | null;
  loanIds: Types.ObjectId[];
  /** part of `amount` that tops up the security deposit */
  depositAmount: number;
}

async function priceMembership(
  libraryId: string,
  memberId: Types.ObjectId,
  planId: string,
  couponCode?: string,
): Promise<Charge> {
  const plan = await MembershipPlanModel.findOne({
    _id: parseId(planId, 'Plan'),
    active: true,
  }).lean();
  if (!plan) throw notFound('Plan');
  await applyDuePlanChanges(new Date(), memberId);
  await assertPlanPurchasable(
    await MemberProfileModel.findOne({ userId: memberId })
      .select('planId validTill nextPlan')
      .lean(),
    plan,
  );
  let discount = 0;
  let code: string | null = null;
  if (couponCode) {
    const coupon = await findUsableCoupon(couponCode);
    if (!coupon) throw new AppError(400, 'INVALID_COUPON', 'That coupon is not valid');
    discount = Math.round((plan.price * coupon.discountPercent) / 100);
    code = coupon.code;
  }
  // The deposit (same for every member) is collected with the first
  // membership, and topped back up at renewal if deductions used some of it.
  const depositAmount = await depositShortfall(libraryId, memberId);
  return {
    purpose: 'membership',
    amount: plan.price - discount + depositAmount,
    discount,
    couponCode: code,
    planId: plan._id,
    loanIds: [],
    depositAmount,
  };
}

async function priceDues(memberId: Types.ObjectId): Promise<Charge> {
  const loans = await LoanModel.find({
    memberId,
    duesPaidAt: null,
    status: { $in: ['returned', 'lost'] },
  })
    .select('fineAmount damageCharge duesPaidAmount')
    .lean();
  // Only what is still owed: a deposit deduction may have paid part of it.
  const amount = loans.reduce(
    (sum, l) => sum + Math.max(0, l.fineAmount + l.damageCharge - (l.duesPaidAmount ?? 0)),
    0,
  );
  if (amount === 0) throw new AppError(409, 'NOTHING_DUE', 'There are no fines to pay');
  return {
    purpose: 'fine',
    amount,
    discount: 0,
    couponCode: null,
    planId: null,
    loanIds: loans.map((l) => l._id),
    depositAmount: 0,
  };
}

async function assertVerified(memberId: Types.ObjectId) {
  const profile = await MemberProfileModel.findOne({ userId: memberId })
    .select('verificationStatus')
    .lean();
  if (profile?.verificationStatus !== 'approved') {
    throw new AppError(
      403,
      'VERIFICATION_PENDING',
      'Verification pending: staff must approve the ID proof first',
    );
  }
}

export type ChargeRequest =
  { purpose: 'membership'; planId: string; couponCode?: string } | { purpose: 'fine' };

async function priceFor(libraryId: string, memberId: Types.ObjectId, req: ChargeRequest) {
  await assertVerified(memberId);
  return req.purpose === 'membership'
    ? priceMembership(libraryId, memberId, req.planId, req.couponCode)
    : priceDues(memberId);
}

/** Creates a timer-bound payment and its Razorpay order (online and counter UPI). */
async function createGatewayPayment(
  libraryId: string,
  memberId: Types.ObjectId,
  charge: Charge,
  method: 'online' | 'counterUpi',
) {
  if (charge.amount < 100)
    throw new AppError(400, 'AMOUNT_TOO_SMALL', 'Online payments must be at least ₹1');
  const gateway = await libraryGateway(libraryId);
  const payment = await PaymentModel.create({
    ...charge,
    memberId,
    method,
    expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
    payToken: method === 'counterUpi' ? randomBytes(18).toString('base64url') : null,
    history: [{ status: 'created', at: new Date(), source: method }],
  });
  try {
    const order = await callGateway(() =>
      gateway.createOrder({
        amount: charge.amount,
        receipt: String(payment._id),
        notes: { paymentId: String(payment._id), libraryId },
      }),
    );
    payment.razorpayOrderId = order.id;
    await payment.save();
  } catch (err) {
    await transitionPayment(payment._id, 'failed', {
      source: 'system',
      note: 'order creation failed',
    });
    throw err;
  }
  return { payment, keyId: gateway.keyId };
}

/** FR-20/23: a member pays online from their phone. */
export async function startCheckout(
  libraryId: string,
  userId: string,
  req: ChargeRequest,
): Promise<CheckoutDto> {
  const memberId = new Types.ObjectId(userId);
  const charge = await priceFor(libraryId, memberId, req);
  const { payment, keyId } = await createGatewayPayment(libraryId, memberId, charge, 'online');
  const [user, library] = await Promise.all([
    UserModel.findById(memberId).select('name email').lean(),
    LibraryModel.findById(libraryId).select('name').lean(),
  ]);
  return {
    payment: await toDto(payment),
    orderId: payment.razorpayOrderId!,
    keyId,
    libraryName: library?.name ?? '',
    prefill: { name: user?.name ?? '', email: user?.email ?? '' },
  };
}

/** The member opened Razorpay Checkout: created → pending. */
export async function markOpened(userId: string, paymentId: string) {
  const payment = await PaymentModel.findOne({
    _id: parseId(paymentId, 'Payment'),
    memberId: new Types.ObjectId(userId),
  });
  if (!payment) throw notFound('Payment');
  if (payment.status === 'created')
    await transitionPayment(payment._id, 'pending', { source: 'checkout-opened' });
}

/** FR-17: counter payment by UPI QR or cash. Cash succeeds at once and is audited. */
export async function counterPayment(
  libraryId: string,
  input: ChargeRequest & { memberToken: string; method: 'counterUpi' | 'cash' },
  actor: Actor,
) {
  const memberId = new Types.ObjectId(verifyCardToken(input.memberToken, libraryId));
  const charge = await priceFor(libraryId, memberId, input);

  if (input.method === 'counterUpi') {
    const { payment } = await createGatewayPayment(libraryId, memberId, charge, 'counterUpi');
    const payUrl = `${env.CLIENT_URL}/pay/${payment.payToken}`;
    return {
      payment: await toDto(payment),
      payUrl,
      payQrDataUrl: await QRCode.toDataURL(payUrl, { margin: 1, width: 320 }),
    };
  }

  const payment = await PaymentModel.create({
    ...charge,
    memberId,
    method: 'cash',
    collectedBy: new Types.ObjectId(actor.id),
    expiresAt: new Date(Date.now() + PAYMENT_WINDOW_MS),
    history: [{ status: 'created', at: new Date(), source: 'cash' }],
  });
  const staff = await UserModel.findById(actor.id).select('name').lean();
  const { payment: paid } = await transitionPayment(payment._id, 'success', {
    source: 'cash',
    set: { paidAt: new Date() },
  });
  await recordAudit({
    libraryId,
    actor,
    action: 'payment.cash',
    target: { type: 'payment', id: payment._id },
    details: { amount: charge.amount, purpose: charge.purpose, collectedBy: staff?.name ?? null },
  });
  await applySuccess(libraryId, paid);
  return {
    payment: await toDto(await PaymentModel.findById(payment._id).orFail()),
    payUrl: null,
    payQrDataUrl: null,
  };
}

// ---------------------------------------------------------------- success effects

function receiptNumber(slug: string, p: { _id: Types.ObjectId; paidAt?: Date | null }) {
  const d = (p.paidAt ?? new Date()).toISOString().slice(0, 10).replace(/-/g, '');
  return `${slug.slice(0, 6).toUpperCase()}-${d}-${String(p._id).slice(-6).toUpperCase()}`;
}

async function receiptData(libraryId: string, p: PaymentDoc) {
  const [library, member, profile, plan, collector] = await Promise.all([
    LibraryModel.findById(libraryId).select('name').lean(),
    UserModel.findById(p.memberId).select('name email').lean(),
    MemberProfileModel.findOne({ userId: p.memberId }).select('membershipNo').lean(),
    p.planId ? MembershipPlanModel.findById(p.planId).select('name').lean() : null,
    p.collectedBy ? UserModel.findById(p.collectedBy).select('name').lean() : null,
  ]);
  return {
    email: member?.email,
    data: {
      receiptNo: p.receiptNo ?? '',
      libraryName: library?.name ?? '',
      memberName: member?.name ?? '',
      membershipNo: profile?.membershipNo ?? null,
      description: describe(p, plan?.name ?? null),
      amount: p.amount,
      discount: p.discount,
      couponCode: p.couponCode ?? null,
      method: p.method,
      paidAt: p.paidAt ?? new Date(),
      razorpayPaymentId: p.razorpayPaymentId ?? null,
      collectedBy: collector?.name ?? null,
      refund: p.refund ?? null,
    },
  };
}

/** Membership activation or dues settlement, receipt, email and live push. */
async function applySuccess(libraryId: string, payment: PaymentDoc) {
  const now = new Date();
  if (payment.purpose === 'membership' && payment.planId) {
    const plan = await MembershipPlanModel.findById(payment.planId).lean();
    const profile = await MemberProfileModel.findOne({ userId: payment.memberId });
    if (plan && profile) {
      // A different plan bought mid-period starts when the current one ends.
      applyMembership(profile, plan, payment._id, now);
      profile.set({
        expiryReminderAt: null,
        // Shown once as a celebration, only after a confirmed payment.
        celebratePaymentId: payment._id,
        // Rejoining after a deposit refund reopens the membership.
        membershipClosedAt: null,
      });
      await profile.save();
      await collectDeposit(payment.memberId, payment.depositAmount ?? 0, payment._id);
    }
  } else if (payment.purpose === 'fine') {
    // Pays exactly what each listed loan still owes, then closes the dues cycle.
    await LoanModel.updateMany({ _id: { $in: payment.loanIds }, duesPaidAt: null }, [
      {
        $set: {
          duesPaidAmount: { $add: ['$fineAmount', '$damageCharge'] },
          duesPaidAt: now,
          duesPaymentId: payment._id,
        },
      },
    ]);
    await closeCycleIfPaid(payment.memberId, 'payment');
  }

  const library = await LibraryModel.findById(libraryId).select('slug').lean();
  payment.receiptNo = receiptNumber(library?.slug ?? 'LV', payment);
  await PaymentModel.updateOne({ _id: payment._id }, { $set: { receiptNo: payment.receiptNo } });

  const { email, data } = await receiptData(libraryId, payment);
  if (email) {
    const profile =
      payment.purpose === 'membership'
        ? await MemberProfileModel.findOne({ userId: payment.memberId })
            .select('validTill membershipNo depositBalance nextPlan')
            .lean()
        : null;
    const planName = data.description.replace(/^Membership: /, '');
    const startsLater =
      profile?.nextPlan && String(profile.nextPlan.planId) === String(payment.planId)
        ? profile.nextPlan.startsAt
        : null;
    const membershipLines = profile
      ? [
          startsLater
            ? `Thank you! Your ${planName} plan starts on ${startsLater.toLocaleDateString('en-IN', { dateStyle: 'medium' })}, when your current plan ends.`
            : `Congratulations! Your membership is active.`,
          '',
          `Plan: ${planName}`,
          `Valid till: ${profile.validTill?.toLocaleDateString('en-IN', { dateStyle: 'medium' }) ?? '-'}`,
          `Card number: ${profile.membershipNo?.replace(/(\d{4})(?=\d)/g, '$1 ') ?? '-'}`,
          ...(payment.depositAmount
            ? [
                `Security deposit paid: ${rupees(payment.depositAmount)} (balance ${rupees(profile.depositBalance ?? 0)})`,
              ]
            : []),
          '',
        ]
      : [];
    await sendMail({
      to: email,
      subject:
        payment.purpose === 'membership'
          ? `Your ${data.libraryName} membership is active (receipt ${data.receiptNo})`
          : `Receipt ${data.receiptNo}: ${rupees(payment.amount)} paid to ${data.libraryName}`,
      text: [
        `Hi ${data.memberName},`,
        '',
        ...membershipLines,
        `We received ${rupees(payment.amount)} for ${data.description.toLowerCase()}. Your receipt is attached.`,
      ].join('\n'),
      attachments: [
        {
          filename: `receipt-${data.receiptNo}.pdf`,
          content: await receiptPdf(data),
          contentType: 'application/pdf',
        },
      ],
    });
  }
  await push(libraryId, payment);
}

async function push(libraryId: string, p: PaymentDoc) {
  const member = await UserModel.findById(p.memberId).select('name').lean();
  emitPaymentUpdated(libraryId, {
    paymentId: String(p._id),
    status: p.status,
    purpose: p.purpose,
    amount: p.amount,
    memberId: String(p.memberId),
    memberName: member?.name ?? 'Member',
  });
}

// ---------------------------------------------------------------- webhook (FR-26)

export class InvalidSignatureError extends AppError {
  constructor() {
    super(400, 'INVALID_SIGNATURE', 'Webhook signature does not match');
  }
}

/** HMAC-SHA256 of the raw body with the webhook secret, compared in constant time. */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface RazorpayEvent {
  event: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        amount?: number;
        error_description?: string;
        created_at?: number;
      };
    };
  };
}

/**
 * Entry point for /api/webhooks/razorpay/:libraryId. Only a correctly signed
 * body can move a payment to success (TC-03). Returns what was done, for logs.
 */
export async function handleWebhook(
  libraryId: string,
  rawBody: Buffer,
  signature: string | undefined,
  eventId: string | undefined,
): Promise<string> {
  if (!/^[a-f\d]{24}$/i.test(libraryId)) throw new InvalidSignatureError();
  const library = await LibraryModel.findById(libraryId).select('+razorpayWebhookSecret').lean();
  const secret = library?.razorpayWebhookSecret as EncryptedValue | null | undefined;
  if (!secret || !verifyWebhookSignature(rawBody, signature, decryptSecret(secret))) {
    throw new InvalidSignatureError();
  }

  if (eventId) {
    try {
      await WebhookEventModel.create({ eventId, source: `library:${libraryId}` });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return 'duplicate delivery';
      throw err;
    }
  }

  const event = JSON.parse(rawBody.toString('utf8')) as RazorpayEvent;
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity.id) return `ignored ${event.event}`;

  return runWithTenant(libraryId, async () => {
    const payment = await PaymentModel.findOne({ razorpayOrderId: entity.order_id });
    if (!payment) return 'unknown order';
    if (event.event === 'payment.failed') {
      return settleFailure(
        libraryId,
        payment,
        entity.id!,
        entity.error_description ?? 'Payment failed',
        'webhook',
      );
    }
    if (event.event !== 'payment.captured' && event.event !== 'order.paid')
      return `ignored ${event.event}`;
    return settleCapture(libraryId, payment, {
      id: entity.id!,
      amount: entity.amount ?? -1,
      createdAt: entity.created_at ? new Date(entity.created_at * 1000) : null,
      source: 'webhook',
    });
  });
}

type PaymentDocument = HydratedDocument<Payment>;

/** A failed attempt ends a still-open request (one attempt per order). */
async function settleFailure(
  libraryId: string,
  payment: PaymentDocument,
  razorpayPaymentId: string | null,
  reason: string,
  source: string,
) {
  if (payment.status !== 'created' && payment.status !== 'pending')
    return `already ${payment.status}`;
  const { payment: failed, changed } = await transitionPayment(payment._id, 'failed', {
    source,
    set: { failureReason: reason, ...(razorpayPaymentId ? { razorpayPaymentId } : {}) },
  });
  if (changed) await push(libraryId, failed);
  return 'failed';
}

/**
 * A capture reported by the verified webhook or read from Razorpay's API.
 * Succeeds only if the amount matches and Razorpay took the payment within the
 * request's window; otherwise it never activates anything and is refunded.
 * Repeated reports are no-ops (terminal states never change).
 */
async function settleCapture(
  libraryId: string,
  payment: PaymentDocument,
  capture: { id: string; amount: number; createdAt: Date | null; source: string },
) {
  if (capture.amount !== payment.amount) {
    await recordAudit({
      libraryId,
      actor: null,
      action: 'payment.amountMismatch',
      target: { type: 'payment', id: payment._id },
      details: {
        expected: payment.amount,
        received: capture.amount,
        razorpayPaymentId: capture.id,
      },
    });
    return 'amount mismatch';
  }
  if (payment.status === 'success') return 'already success';

  const now = new Date();
  const paidAt = capture.createdAt && capture.createdAt < now ? capture.createdAt : now;
  if (
    (payment.status === 'created' || payment.status === 'pending') &&
    paidAt <= payment.expiresAt
  ) {
    const { payment: paid, changed } = await transitionPayment(payment._id, 'success', {
      source: capture.source,
      set: { razorpayPaymentId: capture.id, paidAt: now },
    });
    if (changed) {
      await recordAudit({
        libraryId,
        actor: null,
        action: 'payment.success',
        target: { type: 'payment', id: paid._id },
        details: {
          amount: paid.amount,
          purpose: paid.purpose,
          method: paid.method,
          razorpayPaymentId: capture.id,
          confirmedBy: capture.source,
        },
      });
      await applySuccess(libraryId, paid);
    }
    return 'success';
  }

  // Taken after the window closed, or for a request already failed/expired.
  if (payment.status === 'created' || payment.status === 'pending') {
    await transitionPayment(payment._id, 'expired', {
      source: capture.source,
      note: 'captured after expiry',
    });
  }
  if (payment.lateCapture) return 'late capture already refunded';
  const gateway = await libraryGateway(libraryId);
  const refund = await callGateway(() =>
    gateway.refund(capture.id, capture.amount, {
      reason: 'captured after payment request expired',
    }),
  );
  await PaymentModel.updateOne(
    { _id: payment._id },
    {
      $set: {
        lateCapture: { razorpayPaymentId: capture.id, razorpayRefundId: refund.id, at: now },
      },
    },
  );
  await recordAudit({
    libraryId,
    actor: null,
    action: 'payment.lateCaptureRefunded',
    target: { type: 'payment', id: payment._id },
    details: { amount: capture.amount, razorpayPaymentId: capture.id, razorpayRefundId: refund.id },
  });
  return 'late capture refunded';
}

/**
 * Server-to-server check (no webhook needed): asks Razorpay for the order's
 * payment attempts with the library's own keys. The browser's word is never
 * used. Returns the payment's status afterwards. Tenant context.
 */
export async function reconcilePayment(libraryId: string, paymentId: Types.ObjectId | string) {
  const payment = await PaymentModel.findById(paymentId);
  if (!payment) throw notFound('Payment');
  if (!payment.razorpayOrderId || (payment.status !== 'created' && payment.status !== 'pending')) {
    return payment.status;
  }
  const gateway = await libraryGateway(libraryId);
  const attempts = await callGateway(() => gateway.fetchOrderPayments(payment.razorpayOrderId!));
  const captured = attempts.find((a) => a.status === 'captured');
  if (captured) {
    await settleCapture(libraryId, payment, { ...captured, source: 'api-check' });
  } else if (attempts.length > 0 && attempts.every((a) => a.status === 'failed')) {
    const last = attempts[attempts.length - 1]!;
    await settleFailure(
      libraryId,
      payment,
      last.id,
      last.errorDescription ?? 'Payment failed',
      'api-check',
    );
  }
  return (await PaymentModel.findById(payment._id).select('status').lean())!.status;
}

/** The member closed Checkout. Check Razorpay first; if nothing was paid, end the request. */
export async function cancelPayment(libraryId: string, paymentId: Types.ObjectId | string) {
  const status = await reconcilePayment(libraryId, paymentId);
  if (status !== 'created' && status !== 'pending') return status;
  const payment = await PaymentModel.findById(paymentId);
  const gateway = await libraryGateway(libraryId);
  const attempts = payment?.razorpayOrderId
    ? await callGateway(() => gateway.fetchOrderPayments(payment.razorpayOrderId!))
    : [];
  // An attempt still in flight (e.g. a UPI app approval) keeps the request open.
  if (attempts.some((a) => a.status === 'created' || a.status === 'authorized')) return status;
  await settleFailure(libraryId, payment!, null, 'Cancelled before payment', 'checkout-cancelled');
  return 'failed';
}

async function ownedPayment(userId: string, paymentId: string) {
  const payment = await PaymentModel.findOne({
    _id: parseId(paymentId, 'Payment'),
    memberId: new Types.ObjectId(userId),
  }).select('_id');
  if (!payment) throw notFound('Payment');
  return payment._id;
}

export async function verifyMemberPayment(libraryId: string, userId: string, paymentId: string) {
  await reconcilePayment(libraryId, await ownedPayment(userId, paymentId));
  return getPayment(paymentId, userId);
}

export async function cancelMemberPayment(libraryId: string, userId: string, paymentId: string) {
  await cancelPayment(libraryId, await ownedPayment(userId, paymentId));
  return getPayment(paymentId, userId);
}

/** Open gateway payments older than 90 s: ask Razorpay (cron, every minute). */
export async function reconcileOpenPayments(libraryId: string, now = new Date()) {
  const open = await PaymentModel.find({
    status: { $in: ['created', 'pending'] },
    razorpayOrderId: { $ne: null },
    createdAt: { $lt: new Date(now.getTime() - 90_000) },
    expiresAt: { $gte: now },
  })
    .select('_id')
    .limit(25)
    .lean();
  for (const p of open) await reconcilePayment(libraryId, p._id).catch(() => undefined);
  return open.length;
}

export async function verifyStaffPayment(libraryId: string, paymentId: string) {
  await reconcilePayment(libraryId, parseId(paymentId, 'Payment'));
  return getPayment(paymentId);
}

// ---------------------------------------------------------------- expiry (TC-02)

/** Marks unpaid requests past their window as expired. Tenant context. */
export async function expirePayments(libraryId: string, now = new Date()) {
  const stale = await PaymentModel.find({
    status: { $in: ['created', 'pending'] },
    expiresAt: { $lt: now },
  });
  let count = 0;
  for (const p of stale) {
    // A payment Razorpay took in time must not expire just because no webhook came.
    if (p.razorpayOrderId) await reconcilePayment(libraryId, p._id).catch(() => undefined);
    try {
      const { payment, changed } = await transitionPayment(p._id, 'expired', { source: 'cron' });
      if (changed) {
        count++;
        await push(libraryId, payment);
      }
    } catch {
      // A webhook settled it between the query and now; nothing to do.
    }
  }
  return count;
}

// ---------------------------------------------------------------- refunds (FR-11)

export async function refundPayment(
  libraryId: string,
  id: string,
  input: { amount?: number; reason: string },
  actor: Actor,
) {
  const payment = await PaymentModel.findById(parseId(id, 'Payment'));
  if (!payment) throw notFound('Payment');
  if (payment.status !== 'success')
    throw new AppError(409, 'NOT_REFUNDABLE', 'Only successful payments can be refunded');
  if (payment.refund)
    throw new AppError(409, 'ALREADY_REFUNDED', 'This payment has already been refunded');
  const amount = input.amount ?? payment.amount;
  if (amount < 1 || amount > payment.amount) {
    throw new AppError(400, 'INVALID_AMOUNT', `Refund between ₹0.01 and ${rupees(payment.amount)}`);
  }

  let razorpayRefundId: string | null = null;
  if (payment.method !== 'cash') {
    const gateway = await libraryGateway(libraryId);
    razorpayRefundId = (
      await callGateway(() =>
        gateway.refund(payment.razorpayPaymentId!, amount, { reason: input.reason }),
      )
    ).id;
  }
  payment.refund = {
    amount,
    reason: input.reason,
    razorpayRefundId,
    refundedAt: new Date(),
    refundedBy: new Types.ObjectId(actor.id),
  };
  await payment.save();
  await recordAudit({
    libraryId,
    actor,
    action: 'payment.refunded',
    target: { type: 'payment', id: payment._id },
    details: { amount, reason: input.reason, method: payment.method, razorpayRefundId },
  });

  const member = await UserModel.findById(payment.memberId).select('name email').lean();
  if (member) {
    await sendMail({
      to: member.email,
      subject: `Refund of ${rupees(amount)}`,
      text: `Hi ${member.name},\n\n${rupees(amount)} has been refunded${payment.method === 'cash' ? ' in cash' : ' to your original payment method'}.\n\nReason: ${input.reason}`,
    });
  }
  return toDto(payment);
}

// ---------------------------------------------------------------- reads

export async function listPayments(filter: {
  status?: string;
  purpose?: string;
  method?: string;
  memberId?: string;
}) {
  const q: Record<string, unknown> = {};
  if (filter.status) q.status = filter.status;
  if (filter.purpose) q.purpose = filter.purpose;
  if (filter.method) q.method = filter.method;
  if (filter.memberId) q.memberId = parseId(filter.memberId, 'Member');
  const list = await PaymentModel.find(q).sort({ createdAt: -1 }).limit(300).lean();
  return toPaymentDtos(list);
}

export async function getPayment(id: string, memberId?: string) {
  const p = await PaymentModel.findOne({
    _id: parseId(id, 'Payment'),
    ...(memberId ? { memberId: new Types.ObjectId(memberId) } : {}),
  }).lean();
  if (!p) throw notFound('Payment');
  return toDto(p);
}

export async function paymentReceipt(libraryId: string, id: string, memberId?: string) {
  const p = await PaymentModel.findOne({
    _id: parseId(id, 'Payment'),
    ...(memberId ? { memberId: new Types.ObjectId(memberId) } : {}),
  }).lean();
  if (!p || p.status !== 'success' || !p.receiptNo) throw notFound('Receipt');
  const { data } = await receiptData(libraryId, p);
  return { filename: `receipt-${data.receiptNo}.pdf`, pdf: await receiptPdf(data) };
}

// ---------------------------------------------------------------- public pay link

/**
 * /pay/:token: the page a member reaches by scanning the counter QR. The token
 * is 144 random bits and resolves the tenant, so this lookup runs in system
 * context, keyed by that token only.
 */
export function publicPay(token: string): Promise<PublicPayDto> {
  return runAsSystem('public:pay-link', async () => {
    if (!/^[\w-]{20,40}$/.test(token)) throw notFound('Payment');
    const p = await PaymentModel.findOne({ payToken: token }).lean();
    if (!p) throw notFound('Payment');
    const [library, plan] = await Promise.all([
      LibraryModel.findById(p.libraryId).select('name razorpayKeyId').lean(),
      p.planId ? MembershipPlanModel.findById(p.planId).select('name').lean() : null,
    ]);
    return {
      paymentId: String(p._id),
      libraryName: library?.name ?? '',
      description: describe(p, plan?.name ?? null),
      amount: p.amount,
      status: p.status,
      expiresAt: p.expiresAt.toISOString(),
      orderId: p.razorpayOrderId ?? null,
      keyId: library?.razorpayKeyId ?? null,
    };
  });
}

/** The pay-link page asks the server to check with Razorpay (no trust in the browser). */
export function publicPayVerify(token: string) {
  return runAsSystem('public:pay-link', async () => {
    const p = await PaymentModel.findOne({ payToken: token }).select('libraryId').lean();
    if (!p) throw notFound('Payment');
    await runWithTenant(p.libraryId, () => reconcilePayment(String(p.libraryId), p._id));
    return publicPay(token);
  });
}

export function publicPayOpened(token: string) {
  return runAsSystem('public:pay-link', async () => {
    const p = await PaymentModel.findOne({ payToken: token }).select('libraryId status').lean();
    if (!p) throw notFound('Payment');
    if (p.status === 'created') {
      await runWithTenant(p.libraryId, () =>
        transitionPayment(p._id, 'pending', { source: 'pay-link-opened' }),
      );
    }
  });
}
