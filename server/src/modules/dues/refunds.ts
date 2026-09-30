import { Types } from 'mongoose';
import type {
  DepositRefundDto,
  DepositRefundRequestDto,
  RefundMethod,
  Role,
} from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { notFound, parseId } from '../../core/ids';
import { notify } from '../../core/notify';
import { recordAudit } from '../audit/service';
import { circulationSettings, rupees } from '../circulation/rules';
import { LoanModel } from '../loans/model';
import { MemberProfileModel } from '../members/model';
import { callGateway, libraryGateway } from '../payments/gateway';
import { PaymentModel } from '../payments/model';
import { UserModel } from '../users/model';
import { DepositTransactionModel } from './model';
import { deductFromDeposit, outstandingDues } from './service';

// Deposit refunds (tenant context). The member asks; staff approve and pay it
// out in cash or back through Razorpay; the membership then closes.
// Unpaid dues are taken from the deposit first, so only the remainder is
// refunded, and an empty deposit refunds nothing.

type Actor = { id: string; role: Role };

async function facts(memberId: Types.ObjectId) {
  const [profile, due, activeLoans] = await Promise.all([
    MemberProfileModel.findOne({ userId: memberId }).lean(),
    outstandingDues(memberId),
    LoanModel.countDocuments({ memberId, status: 'active' }),
  ]);
  if (!profile) throw notFound('Member');
  const balance = profile.depositBalance ?? 0;
  return { profile, due, activeLoans, balance, refundable: Math.max(0, balance - due) };
}

function whyNot(f: Awaited<ReturnType<typeof facts>>): string | null {
  if (f.activeLoans > 0) {
    return `Return the ${f.activeLoans} book${f.activeLoans > 1 ? 's' : ''} you have first`;
  }
  if (f.balance === 0) return 'Your deposit is ₹0, so there is nothing to refund';
  if (f.refundable === 0) {
    return `Your unpaid dues (${rupees(f.due)}) use up the whole deposit, so there is nothing to refund`;
  }
  return null;
}

/** Deposit paid online and not yet refunded, per payment, newest first. */
async function onlineDepositPayments(memberId: Types.ObjectId) {
  const payments = await PaymentModel.find({
    memberId,
    purpose: 'membership',
    status: 'success',
    method: { $in: ['online', 'counterUpi'] },
    depositAmount: { $gt: 0 },
    razorpayPaymentId: { $ne: null },
  })
    .sort({ paidAt: -1 })
    .lean();
  return payments
    .map((p) => ({ p, left: (p.depositAmount ?? 0) - (p.depositRefunded ?? 0) }))
    .filter((x) => x.left > 0);
}

export async function myRefund(userId: string): Promise<DepositRefundDto> {
  const f = await facts(new Types.ObjectId(userId));
  const r = f.profile.depositRefund;
  const open = r?.status === 'requested';
  return {
    status: r?.status ?? null,
    requestedAt: r?.requestedAt?.toISOString() ?? null,
    decidedAt: r?.decidedAt?.toISOString() ?? null,
    method: r?.method ?? null,
    amount: r?.status === 'completed' ? (r.amount ?? 0) : f.refundable,
    depositBalance: f.balance,
    outstandingDues: f.due,
    activeLoans: f.activeLoans,
    blockedReason: open ? null : whyNot(f),
    note: r?.note ?? null,
  };
}

async function member(libraryId: string, memberId: Types.ObjectId) {
  const u = await UserModel.findById(memberId).select('name email').lean();
  const { libraryName } = await circulationSettings(libraryId);
  return u
    ? { to: { libraryId, userId: String(memberId), email: u.email }, name: u.name, libraryName }
    : null;
}

export async function requestRefund(
  libraryId: string,
  userId: string,
  reason?: string,
  by: 'member' | 'staff' = 'member',
) {
  const memberId = new Types.ObjectId(userId);
  const f = await facts(memberId);
  const blocked = whyNot(f);
  if (blocked) throw new AppError(409, 'CANNOT_REFUND', blocked);
  const now = new Date();
  const res = await MemberProfileModel.updateOne(
    { _id: f.profile._id, 'depositRefund.status': { $ne: 'requested' } },
    {
      $set: {
        depositRefund: {
          status: 'requested',
          requestedAt: now,
          requestedBy: by,
          reason: reason ?? null,
        },
      },
    },
  );
  if (res.modifiedCount === 0)
    throw new AppError(409, 'ALREADY_REQUESTED', 'A refund request is already open');
  if (by === 'member') {
    const m = await member(libraryId, memberId);
    if (m) {
      await notify(m.to, {
        type: 'deposit.refundRequested',
        subject: `We received your deposit refund request`,
        text: `Hi ${m.name},\n\nWe received your request to refund your security deposit at ${m.libraryName}. Expected refund: ${rupees(f.refundable)} (deposit ${rupees(f.balance)}${f.due ? ` minus unpaid dues ${rupees(f.due)}` : ''}).\n\nOnce the library approves it, your membership will close. You can rejoin any time by paying a new deposit with a membership.`,
      });
    }
  }
  return myRefund(userId);
}

export async function cancelRequest(userId: string) {
  const res = await MemberProfileModel.updateOne(
    { userId: new Types.ObjectId(userId), 'depositRefund.status': 'requested' },
    { $set: { 'depositRefund.status': 'cancelled', 'depositRefund.decidedAt': new Date() } },
  );
  if (res.modifiedCount === 0)
    throw new AppError(409, 'NO_REQUEST', 'There is no open refund request');
  return myRefund(userId);
}

export async function listRequests(): Promise<DepositRefundRequestDto[]> {
  const profiles = await MemberProfileModel.find({ 'depositRefund.status': 'requested' })
    .sort({ 'depositRefund.requestedAt': 1 })
    .lean();
  const users = await UserModel.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select('name email')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const rows: DepositRefundRequestDto[] = [];
  for (const p of profiles) {
    const memberId = p.userId as Types.ObjectId;
    const f = await facts(memberId);
    const online = await onlineDepositPayments(memberId);
    rows.push({
      profileId: String(p._id),
      name: byId.get(String(memberId))?.name ?? 'Member',
      email: byId.get(String(memberId))?.email ?? '',
      requestedAt: p.depositRefund!.requestedAt.toISOString(),
      reason: p.depositRefund!.reason ?? null,
      depositBalance: f.balance,
      outstandingDues: f.due,
      refundable: f.refundable,
      activeLoans: f.activeLoans,
      razorpayRefundable: Math.min(
        f.refundable,
        online.reduce((s, x) => s + x.left, 0),
      ),
    });
  }
  return rows;
}

/**
 * Approves a request: settles dues from the deposit, refunds the rest (cash or
 * Razorpay), empties the deposit, and closes the membership. Runs once per
 * request: the claim step moves it out of `requested` atomically.
 */
export async function approveRefund(
  libraryId: string,
  profileId: string,
  method: RefundMethod,
  actor: Actor,
  note?: string,
) {
  const _id = parseId(profileId, 'Member');
  const profile = await MemberProfileModel.findOne({
    _id,
    'depositRefund.status': 'requested',
  }).lean();
  if (!profile)
    throw new AppError(409, 'NO_REQUEST', 'There is no open refund request for this member');
  const memberId = profile.userId as Types.ObjectId;
  const requestKey = `${String(_id)}:${profile.depositRefund!.requestedAt.getTime()}`;

  const before = await facts(memberId);
  const blocked = before.activeLoans > 0 ? whyNot(before) : null;
  if (blocked) throw new AppError(409, 'CANNOT_REFUND', blocked);

  // Razorpay needs the deposit to have been paid online; check before changing anything.
  const online = method === 'razorpay' ? await onlineDepositPayments(memberId) : [];
  if (method === 'razorpay') {
    const available = online.reduce((s, x) => s + x.left, 0);
    if (available < before.refundable) {
      throw new AppError(
        409,
        'USE_CASH',
        `Only ${rupees(available)} of this deposit was paid online, so ${rupees(before.refundable)} cannot go back through Razorpay. Refund it in cash.`,
      );
    }
  }

  // Claim the request so a double click or a second librarian cannot pay twice.
  const claimed = await MemberProfileModel.updateOne(
    {
      _id,
      'depositRefund.status': 'requested',
      'depositRefund.requestedAt': profile.depositRefund!.requestedAt,
    },
    {
      $set: {
        'depositRefund.status': 'completed',
        'depositRefund.decidedAt': new Date(),
        'depositRefund.decidedBy': new Types.ObjectId(actor.id),
        'depositRefund.method': method,
        'depositRefund.note': note ?? null,
      },
    },
  );
  if (claimed.modifiedCount === 0)
    throw new AppError(409, 'NO_REQUEST', 'This request was already handled');

  // 1. Unpaid dues come out of the deposit first (never below zero).
  let duesSettled = 0;
  if (before.due > 0) {
    const r = await deductFromDeposit(
      libraryId,
      memberId,
      `refund:${requestKey}`,
      new Date(),
      actor,
      {
        reason: 'Unpaid dues settled before the deposit refund',
        sendEmail: false,
      },
    );
    duesSettled = r.deducted;
  }

  // 2. Refund whatever is left, guarded so the balance can't go negative.
  const fresh = await MemberProfileModel.findById(_id).select('depositBalance').lean();
  const amount = fresh?.depositBalance ?? 0;
  const razorpayRefundIds: string[] = [];
  if (amount > 0) {
    // Razorpay first: if it fails before anything was refunded, reopen the
    // request with the deposit untouched.
    if (method === 'razorpay') {
      const gateway = await libraryGateway(libraryId);
      let left = amount;
      for (const { p, left: avail } of online) {
        if (left <= 0) break;
        const part = Math.min(left, avail);
        try {
          const refund = await callGateway(() =>
            gateway.refund(p.razorpayPaymentId!, part, { reason: 'security deposit refund' }),
          );
          razorpayRefundIds.push(refund.id);
        } catch (err) {
          if (razorpayRefundIds.length === 0) {
            await MemberProfileModel.updateOne(
              { _id },
              {
                $set: {
                  'depositRefund.status': 'requested',
                  'depositRefund.decidedAt': null,
                  'depositRefund.decidedBy': null,
                  'depositRefund.method': null,
                },
              },
            );
          }
          throw err;
        }
        await PaymentModel.updateOne({ _id: p._id }, { $inc: { depositRefunded: part } });
        left -= part;
      }
    }
    const took = await MemberProfileModel.updateOne(
      { _id, depositBalance: { $gte: amount } },
      { $inc: { depositBalance: -amount } },
    );
    if (took.modifiedCount === 0)
      throw new AppError(409, 'CHANGED', 'The deposit changed; try again');
    await DepositTransactionModel.create({
      memberId,
      type: 'refund',
      method,
      amount,
      balanceAfter: 0,
      reason:
        method === 'cash' ? 'Deposit refunded in cash' : 'Deposit refunded to the original payment',
      idempotencyKey: `refund:${requestKey}`,
    });
  }

  // 3. Close the membership: no plan, card stops working, can rejoin later.
  const now = new Date();
  await MemberProfileModel.updateOne(
    { _id },
    {
      $set: {
        'depositRefund.amount': amount,
        'depositRefund.duesSettled': duesSettled,
        membershipClosedAt: now,
        planId: null,
        validTill: now,
        celebratePaymentId: null,
      },
    },
  );
  await recordAudit({
    libraryId,
    actor,
    action: 'deposit.refunded',
    target: { type: 'memberProfile', id: _id },
    details: { amount, method, duesSettled, razorpayRefundIds, note: note ?? null },
  });

  const m = await member(libraryId, memberId);
  if (m) {
    await notify(m.to, {
      type: 'deposit.refunded',
      subject: amount > 0 ? `${rupees(amount)} deposit refunded` : 'Your membership is closed',
      text: [
        `Hi ${m.name},`,
        '',
        amount > 0
          ? `We refunded ${rupees(amount)} of your security deposit ${method === 'cash' ? 'in cash at the counter' : 'to your original payment method (it can take 5-7 working days to appear)'}.`
          : 'There was nothing left in your security deposit to refund.',
        ...(duesSettled > 0
          ? [`${rupees(duesSettled)} of the deposit first cleared your unpaid dues.`]
          : []),
        '',
        `Your membership at ${m.libraryName} is now closed. You can rejoin any time by paying a new deposit with a membership.`,
      ].join('\n'),
    });
  }
  return { amount, duesSettled, method };
}

export async function rejectRefund(
  libraryId: string,
  profileId: string,
  reason: string,
  actor: Actor,
) {
  const _id = parseId(profileId, 'Member');
  const p = await MemberProfileModel.findOneAndUpdate(
    { _id, 'depositRefund.status': 'requested' },
    {
      $set: {
        'depositRefund.status': 'rejected',
        'depositRefund.decidedAt': new Date(),
        'depositRefund.decidedBy': new Types.ObjectId(actor.id),
        'depositRefund.note': reason,
      },
    },
  ).lean();
  if (!p) throw new AppError(409, 'NO_REQUEST', 'There is no open refund request for this member');
  await recordAudit({
    libraryId,
    actor,
    action: 'deposit.refundRejected',
    target: { type: 'memberProfile', id: _id },
    details: { reason },
  });
  const m = await member(libraryId, p.userId as Types.ObjectId);
  if (m) {
    await notify(m.to, {
      type: 'deposit.refundRejected',
      subject: 'About your deposit refund request',
      text: `Hi ${m.name},\n\nYour deposit refund request at ${m.libraryName} was not approved.\n\nReason: ${reason}\n\nYour membership continues as before.`,
    });
  }
}

/** Staff start (and approve) a refund at the counter for a member who is leaving. */
export async function staffRefund(
  libraryId: string,
  profileId: string,
  method: RefundMethod,
  actor: Actor,
  note?: string,
) {
  const profile = await MemberProfileModel.findById(parseId(profileId, 'Member'))
    .select('userId depositRefund')
    .lean();
  if (!profile) throw notFound('Member');
  if (profile.depositRefund?.status !== 'requested') {
    await requestRefund(libraryId, String(profile.userId), note, 'staff');
  }
  return approveRefund(libraryId, profileId, method, actor, note);
}
