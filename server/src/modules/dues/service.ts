import { Types } from 'mongoose';
import type { CardStatus, DueStatus, Role } from '@libraverse/shared';
import { notify } from '../../core/notify';
import { runWithTenant } from '../../core/tenant';
import { recordAudit } from '../audit/service';
import { DAY_MS, circulationSettings, membershipStatus } from '../circulation/rules';
import { LoanModel } from '../loans/model';
import { MemberProfileModel, type MemberProfile } from '../members/model';
import { UserModel } from '../users/model';
import { DepositTransactionModel } from './model';
import * as emails from './emails';

// Unpaid dues and the security deposit (tenant context throughout).
//
// A due arises when a book comes back late, damaged or is lost. Once the book
// is back the amount is frozen: waiting never makes it grow. The cycle is:
//   warning 1 at once, warning 2 and 3 every `warningIntervalDays`,
//   a notice the day before the deduction, then the deduction
//   `deductionGraceDays` after warning 3.
// The deduction takes min(deposit, due), so the deposit never goes negative.
// If a due remains once the deposit is 0, the card is blocked until it is paid.

type Actor = { id: string; role: Role } | null;

const UNPAID = { duesPaidAt: null, status: { $in: ['returned', 'lost'] } };
const owedExpr = { $subtract: [{ $add: ['$fineAmount', '$damageCharge'] }, '$duesPaidAmount'] };

/** What the member still owes (paise), across all returned or lost loans. */
export async function outstandingDues(memberId: Types.ObjectId): Promise<number> {
  const [row] = await LoanModel.aggregate<{ total: number }>([
    { $match: { memberId, ...UNPAID } },
    { $group: { _id: null, total: { $sum: owedExpr } } },
  ]);
  return Math.max(0, row?.total ?? 0);
}

/** Unpaid loans oldest first, with what each still owes. */
async function unpaidLoans(memberId: Types.ObjectId) {
  const loans = await LoanModel.find({ memberId, ...UNPAID })
    .sort({ returnedAt: 1, _id: 1 })
    .select('fineAmount damageCharge duesPaidAmount')
    .lean();
  return loans
    .map((l) => ({ id: l._id, owed: l.fineAmount + l.damageCharge - (l.duesPaidAmount ?? 0) }))
    .filter((l) => l.owed > 0);
}

/**
 * Applies `amount` to the member's unpaid loans, oldest first. Returns the loan
 * ids touched. Used by payments (full) and deductions (possibly partial).
 */
export async function settleLoans(
  memberId: Types.ObjectId,
  amount: number,
  paymentId?: Types.ObjectId,
) {
  let left = amount;
  const touched: Types.ObjectId[] = [];
  const now = new Date();
  for (const loan of await unpaidLoans(memberId)) {
    if (left <= 0) break;
    const pay = Math.min(left, loan.owed);
    left -= pay;
    touched.push(loan.id);
    const full = pay === loan.owed;
    await LoanModel.updateOne(
      { _id: loan.id, duesPaidAt: null },
      {
        $inc: { duesPaidAmount: pay },
        ...(full
          ? { $set: { duesPaidAt: now, ...(paymentId ? { duesPaymentId: paymentId } : {}) } }
          : {}),
      },
    );
  }
  return touched;
}

type ProfileLike = Pick<
  MemberProfile,
  'verificationStatus' | 'planId' | 'validTill' | 'depositBalance' | 'dues'
>;

/**
 * The member's standing, derived only from stored data (never set by a client).
 * Card: expired wins over blocked, so paying dues never revives an expired card.
 */
export function standing(p: ProfileLike, outstanding: number, now = new Date()) {
  let dueStatus: DueStatus;
  if (outstanding > 0) {
    if ((p.depositBalance ?? 0) === 0 && p.dues?.lastDeductionAt) dueStatus = 'blocked';
    else if (p.dues?.deductionScheduledFor) dueStatus = 'deductionScheduled';
    else dueStatus = 'pending';
  } else if (p.dues?.lastResolution === 'deduction') dueStatus = 'deducted';
  else if (p.dues?.lastResolution === 'payment') dueStatus = 'paid';
  else dueStatus = 'none';

  const membership = membershipStatus(p, now);
  let cardStatus: CardStatus;
  if (membership === 'unverified' || membership === 'none') cardStatus = membership;
  else if (membership === 'expired') cardStatus = 'expired';
  else if (dueStatus === 'blocked') cardStatus = 'blocked';
  else cardStatus = 'active';
  return { dueStatus, cardStatus };
}

async function recipient(libraryId: string, memberId: Types.ObjectId) {
  const u = await UserModel.findById(memberId).select('name email').lean();
  return u ? { to: { libraryId, userId: String(memberId), email: u.email }, name: u.name } : null;
}

/**
 * A new due exists (late/damaged return, lost book). Starts the warning cycle
 * with warning 1 unless one is already running.
 */
export async function onDueCreated(libraryId: string, memberId: Types.ObjectId, now = new Date()) {
  const due = await outstandingDues(memberId);
  if (due <= 0) return;
  const started = await MemberProfileModel.findOneAndUpdate(
    { userId: memberId, 'dues.since': null },
    {
      $set: {
        'dues.since': now,
        'dues.warningsSent': 1,
        'dues.lastWarningAt': now,
        'dues.deductionScheduledFor': null,
        'dues.noticeSentAt': null,
        'dues.lastResolution': null,
        'dues.lastDeductionAt': null,
      },
    },
    { new: true },
  );
  if (!started) return; // a cycle is already running; it will cover the new amount
  const settings = await circulationSettings(libraryId);
  const r = await recipient(libraryId, memberId);
  if (r) {
    await notify(
      r.to,
      emails.warning(1, {
        name: r.name,
        due,
        deposit: started.depositBalance,
        library: settings.libraryName,
        nextWarningAt: new Date(now.getTime() + settings.warningIntervalDays * DAY_MS),
      }),
    );
  }
}

/** Dues reached 0 (payment or deduction): close the cycle. */
export async function closeCycleIfPaid(
  memberId: Types.ObjectId,
  resolution: 'payment' | 'deduction',
) {
  if ((await outstandingDues(memberId)) > 0) return false;
  await MemberProfileModel.updateOne(
    { userId: memberId },
    {
      $set: {
        'dues.since': null,
        'dues.warningsSent': 0,
        'dues.lastWarningAt': null,
        'dues.deductionScheduledFor': null,
        'dues.noticeSentAt': null,
        'dues.lastResolution': resolution,
      },
    },
  );
  return true;
}

/**
 * Deducts min(deposit, due) once for this cycle. The profile update is guarded
 * by depositBalance >= deduction and by the cycle's idempotency key, so a
 * concurrent or repeated run cannot deduct twice or drive the deposit negative.
 */
export async function deductFromDeposit(
  libraryId: string,
  memberId: Types.ObjectId,
  key: string,
  now = new Date(),
  actor: Actor = null,
  opts: { reason?: string; sendEmail?: boolean } = {},
) {
  const profile = await MemberProfileModel.findOne({ userId: memberId }).lean();
  if (!profile || profile.dues?.lastDeductionKey === key)
    return { deducted: 0, reason: 'already done' };
  const dueBefore = await outstandingDues(memberId);
  const deduction = Math.min(profile.depositBalance ?? 0, dueBefore);

  const claimed = await MemberProfileModel.findOneAndUpdate(
    {
      _id: profile._id,
      depositBalance: { $gte: deduction },
      'dues.lastDeductionKey': { $ne: key },
    },
    {
      $inc: { depositBalance: -deduction },
      $set: {
        'dues.lastDeductionKey': key,
        'dues.lastDeductionAt': now,
        'dues.deductionScheduledFor': null,
      },
    },
    { new: true },
  );
  if (!claimed) return { deducted: 0, reason: 'already done' };

  const loanIds = deduction > 0 ? await settleLoans(memberId, deduction) : [];
  const dueAfter = dueBefore - deduction;
  if (deduction > 0) {
    await DepositTransactionModel.create({
      memberId,
      type: 'deduction',
      amount: deduction,
      balanceAfter: claimed.depositBalance,
      dueBefore,
      dueAfter,
      reason: opts.reason ?? 'Unpaid dues after three warnings',
      loanIds,
      idempotencyKey: `deduction:${key}`,
    });
    await recordAudit({
      libraryId,
      actor,
      action: 'deposit.deducted',
      target: { type: 'memberProfile', id: profile._id },
      details: { amount: deduction, dueBefore, dueAfter, depositAfter: claimed.depositBalance },
    });
  }
  if (dueAfter === 0) await closeCycleIfPaid(memberId, 'deduction');

  const settings = await circulationSettings(libraryId);
  const r = opts.sendEmail === false ? null : await recipient(libraryId, memberId);
  if (r) {
    await notify(
      r.to,
      emails.deducted({
        name: r.name,
        library: settings.libraryName,
        deducted: deduction,
        dueBefore,
        dueAfter,
        deposit: claimed.depositBalance,
        at: now,
      }),
    );
  }
  return { deducted: deduction, dueAfter, depositAfter: claimed.depositBalance };
}

/**
 * Daily job for one library: sends due warnings 2 and 3, the day-before
 * notice, and runs deductions that are due. Safe to run any number of times.
 */
export function processDues(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, async () => {
    const settings = await circulationSettings(libraryId);
    const interval = settings.warningIntervalDays * DAY_MS;
    const counts = { warnings: 0, notices: 0, deductions: 0, closed: 0 };

    // Members with unpaid loans but no cycle yet (e.g. dues from before this feature).
    const owing = await LoanModel.distinct('memberId', {
      ...UNPAID,
      $expr: { $gt: [owedExpr, 0] },
    });
    for (const memberId of owing as Types.ObjectId[]) {
      await onDueCreated(libraryId, memberId, now);
    }

    const cycles = await MemberProfileModel.find({ 'dues.since': { $ne: null } }).lean();
    for (const p of cycles) {
      const memberId = p.userId as Types.ObjectId;
      const due = await outstandingDues(memberId);
      if (due === 0) {
        if (await closeCycleIfPaid(memberId, 'payment')) counts.closed++;
        continue;
      }
      if (p.dues?.lastDeductionAt && (p.depositBalance ?? 0) === 0) continue; // blocked: wait for payment
      const d = p.dues!;
      const r = await recipient(libraryId, memberId);

      if (d.warningsSent < 3 && now.getTime() >= d.since!.getTime() + d.warningsSent * interval) {
        const n = d.warningsSent + 1;
        const set: Record<string, unknown> = { 'dues.warningsSent': n, 'dues.lastWarningAt': now };
        let scheduledFor: Date | null = null;
        if (n === 3) {
          scheduledFor = new Date(now.getTime() + settings.deductionGraceDays * DAY_MS);
          set['dues.deductionScheduledFor'] = scheduledFor;
        }
        const res = await MemberProfileModel.updateOne(
          { _id: p._id, 'dues.warningsSent': d.warningsSent },
          { $set: set },
        );
        if (res.modifiedCount === 1 && r) {
          counts.warnings++;
          await notify(
            r.to,
            emails.warning(n, {
              name: r.name,
              due,
              deposit: p.depositBalance ?? 0,
              library: settings.libraryName,
              nextWarningAt: n < 3 ? new Date(now.getTime() + interval) : null,
              deductionAt: scheduledFor,
            }),
          );
        }
        continue;
      }

      const at = d.deductionScheduledFor;
      if (!at) continue;
      if (!d.noticeSentAt && now.getTime() >= at.getTime() - DAY_MS && now < at) {
        const res = await MemberProfileModel.updateOne(
          { _id: p._id, 'dues.noticeSentAt': null },
          { $set: { 'dues.noticeSentAt': now } },
        );
        if (res.modifiedCount === 1 && r) {
          counts.notices++;
          await notify(
            r.to,
            emails.deductionTomorrow({
              name: r.name,
              library: settings.libraryName,
              due,
              deposit: p.depositBalance ?? 0,
              deduct: Math.min(p.depositBalance ?? 0, due),
              at,
            }),
          );
        }
        continue;
      }
      if (now >= at && !d.noticeSentAt) {
        // Never deduct without the day-before notice: send it now, deduct tomorrow.
        const later = new Date(now.getTime() + DAY_MS);
        const res = await MemberProfileModel.updateOne(
          { _id: p._id, 'dues.noticeSentAt': null },
          { $set: { 'dues.noticeSentAt': now, 'dues.deductionScheduledFor': later } },
        );
        if (res.modifiedCount === 1 && r) {
          counts.notices++;
          await notify(
            r.to,
            emails.deductionTomorrow({
              name: r.name,
              library: settings.libraryName,
              due,
              deposit: p.depositBalance ?? 0,
              deduct: Math.min(p.depositBalance ?? 0, due),
              at: later,
            }),
          );
        }
        continue;
      }
      if (now >= at) {
        const res = await deductFromDeposit(
          libraryId,
          memberId,
          `${String(p._id)}:${at.getTime()}`,
          now,
        );
        if (res.deducted > 0 || res.reason !== 'already done') counts.deductions++;
      }
    }
    return counts;
  });
}

/** Adds to the deposit (collection with a membership payment), once per payment. */
export async function collectDeposit(
  memberId: Types.ObjectId,
  amount: number,
  paymentId: Types.ObjectId,
) {
  if (amount <= 0) return;
  const key = `collected:${String(paymentId)}`;
  if (await DepositTransactionModel.exists({ idempotencyKey: key })) return;
  const profile = await MemberProfileModel.findOneAndUpdate(
    { userId: memberId },
    { $inc: { depositBalance: amount }, $set: { depositCollectedAt: new Date() } },
    { new: true },
  );
  if (!profile) return;
  try {
    await DepositTransactionModel.create({
      memberId,
      type: 'collected',
      amount,
      balanceAfter: profile.depositBalance,
      reason: 'Security deposit paid with membership',
      paymentId,
      idempotencyKey: key,
    });
  } catch (err) {
    // A concurrent duplicate got here first: undo our increment.
    if ((err as { code?: number }).code === 11000) {
      await MemberProfileModel.updateOne(
        { _id: profile._id },
        { $inc: { depositBalance: -amount } },
      );
      return;
    }
    throw err;
  }
}

/** Deposit top-up to charge with the next membership payment (paise). */
export async function depositShortfall(libraryId: string, memberId: Types.ObjectId) {
  const { depositAmount } = await circulationSettings(libraryId);
  const p = await MemberProfileModel.findOne({ userId: memberId }).select('depositBalance').lean();
  return Math.max(0, depositAmount - (p?.depositBalance ?? 0));
}

export async function depositHistory(memberId: Types.ObjectId) {
  const list = await DepositTransactionModel.find({ memberId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return list.map((t) => ({
    id: String(t._id),
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balanceAfter,
    dueBefore: t.dueBefore ?? null,
    dueAfter: t.dueAfter ?? null,
    reason: t.reason,
    createdAt: t.createdAt.toISOString(),
  }));
}
