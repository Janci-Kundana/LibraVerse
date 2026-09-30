import { Types } from 'mongoose';
import type { LoanDto, MemberScanDto, ReturnResultDto, Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { recordAudit } from '../audit/service';
import { BookModel } from '../books/model';
import { verifyCardToken } from '../card/token';
import { BookCopyModel } from '../copies/model';
import { LoanModel, type Loan } from '../loans/model';
import { MemberProfileModel } from '../members/model';
import { applyDuePlanChanges } from '../members/planChange';
import { MembershipPlanModel } from '../membershipPlans/model';
import { ReservationModel } from '../reservations/model';
import { holdCopyForNextReservation } from '../reservations/service';
import { UserModel } from '../users/model';
import { onDueCreated, outstandingDues, standing } from '../dues/service';
import { DAY_MS, circulationSettings, membershipStatus, overdueDays, rupees } from './rules';

export { DAY_MS, circulationSettings, membershipStatus, overdueDays, rupees };

type Actor = { id: string; role: Role };
type LoanDoc = Loan & { _id: Types.ObjectId };

// FR-15/16/22: issue, return, renew. Runs in the librarian's (or member's)
// tenant context. Money in paise.

/** Unpaid late fines plus lost/damage charges, minus anything already paid. */
export const pendingDues = outstandingDues;

export async function toLoanDtos(loans: LoanDoc[], now = new Date()): Promise<LoanDto[]> {
  const [books, copies, users] = await Promise.all([
    BookModel.find({ _id: { $in: loans.map((l) => l.bookId) } })
      .select('title')
      .lean(),
    BookCopyModel.find({ _id: { $in: loans.map((l) => l.copyId) } })
      .select('qrCode')
      .lean(),
    UserModel.find({ _id: { $in: loans.map((l) => l.memberId) } })
      .select('name')
      .lean(),
  ]);
  const title = new Map(books.map((b) => [String(b._id), b.title]));
  const code = new Map(copies.map((c) => [String(c._id), c.qrCode]));
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  return loans.map((l) => {
    const late = overdueDays(l.dueAt, l.returnedAt ?? now);
    return {
      id: String(l._id),
      bookId: String(l.bookId),
      bookTitle: title.get(String(l.bookId)) ?? 'Removed book',
      copyCode: code.get(String(l.copyId)) ?? '',
      memberId: String(l.memberId),
      memberName: name.get(String(l.memberId)) ?? 'Member',
      issuedAt: l.issuedAt.toISOString(),
      dueAt: l.dueAt.toISOString(),
      returnedAt: l.returnedAt ? l.returnedAt.toISOString() : null,
      status: l.status,
      renewals: l.renewals,
      overdueDays: late,
      // An active loan shows the fine it would carry if returned now.
      fineAmount: l.status === 'active' ? late * l.finePerDay : l.fineAmount,
      damageCharge: l.damageCharge,
      duesPaidAmount: l.duesPaidAmount ?? 0,
      chargeNote: l.chargeNote ?? null,
      duesPaid: l.duesPaidAt != null,
    };
  });
}

async function memberSummary(
  libraryId: string,
  memberId: Types.ObjectId,
  now = new Date(),
): Promise<MemberScanDto> {
  // Always the latest data from the database; the QR only carries ids + signature.
  await applyDuePlanChanges(now, memberId);
  const user = await UserModel.findOne({ _id: memberId, role: 'member' })
    .select('name email status')
    .lean();
  const profile = await MemberProfileModel.findOne({ userId: memberId }).lean();
  if (!user || !profile) {
    throw new AppError(
      404,
      'UNKNOWN_CARD',
      'Unknown card: no member with this card in this library',
    );
  }
  if (user.status !== 'active') {
    throw new AppError(
      409,
      'MEMBER_INACTIVE',
      `${user.name}'s account is deactivated. This card cannot be used.`,
    );
  }
  const { libraryName } = await circulationSettings(libraryId);

  const plan = profile.planId ? await MembershipPlanModel.findById(profile.planId).lean() : null;
  const loans = await LoanModel.find({ memberId, status: 'active' }).sort({ dueAt: 1 }).lean();
  const dues = await pendingDues(memberId);
  const status = membershipStatus(profile, now);
  const { cardStatus, dueStatus } = standing(profile, dues, now);
  const overdue = loans.filter((l) => l.dueAt < now).length;
  const bookLimit = plan?.bookLimit ?? 0;

  const ready = await ReservationModel.find({ memberId, status: 'ready' }).lean();
  const readyBooks = await BookModel.find({ _id: { $in: ready.map((r) => r.bookId) } })
    .select('title')
    .lean();
  const readyCopies = await BookCopyModel.find({ _id: { $in: ready.map((r) => r.copyId) } })
    .select('qrCode')
    .lean();

  let blockedReason: string | null = null;
  if (status === 'unverified') blockedReason = 'ID proof is not verified yet';
  else if (status === 'none') blockedReason = 'No active membership plan';
  else if (status === 'expired')
    blockedReason = `Membership expired on ${profile.validTill!.toLocaleDateString('en-IN')}`;
  else if (cardStatus === 'blocked')
    blockedReason = `Card blocked: the deposit is used up and ${rupees(dues)} is still due. Collect it to unblock.`;
  else if (dues > 0)
    blockedReason = `Pending fine of ${rupees(dues)}. Collect payment before issuing.`;
  else if (overdue > 0)
    blockedReason = `${overdue} overdue book${overdue > 1 ? 's' : ''} must be returned first`;
  else if (loans.length >= bookLimit)
    blockedReason = `Borrowing limit reached (${bookLimit} book${bookLimit === 1 ? '' : 's'} on this plan)`;

  return {
    memberId: String(memberId),
    profileId: String(profile._id),
    name: user.name,
    email: user.email,
    phone: profile.phone ?? null,
    photoUrl: profile.photoKey ? `/api/members/${String(profile._id)}/photo` : null,
    libraryName,
    cardIssuedAt: profile.verifiedAt ? profile.verifiedAt.toISOString() : null,
    membershipStartedAt: profile.currentPeriodStart
      ? profile.currentPeriodStart.toISOString()
      : null,
    depositBalance: profile.depositBalance ?? 0,
    cardStatus,
    dueStatus,
    membershipNo: profile.membershipNo ?? null,
    planName: plan?.name ?? null,
    bookLimit,
    validTill: profile.validTill ? profile.validTill.toISOString() : null,
    membershipStatus: status,
    activeLoans: await toLoanDtos(loans, now),
    pendingDues: dues,
    canBorrow: blockedReason === null,
    blockedReason,
    readyReservations: ready.map((r) => ({
      bookTitle: readyBooks.find((b) => String(b._id) === String(r.bookId))?.title ?? '',
      copyCode: readyCopies.find((c) => String(c._id) === String(r.copyId))?.qrCode ?? '',
    })),
  };
}

/** First scan at the counter: whose card is this, and may they borrow? */
export function scanMember(libraryId: string, token: string) {
  return memberSummary(libraryId, new Types.ObjectId(verifyCardToken(token, libraryId)));
}

async function copyByCode(code: string) {
  const copy = await BookCopyModel.findOne({ qrCode: code.trim() });
  if (!copy)
    throw new AppError(404, 'UNKNOWN_COPY', 'No book copy with that QR code in this library');
  return copy;
}

/** Second scan: issue the scanned copy to the scanned member (FR-15). */
export async function issue(
  libraryId: string,
  input: { memberToken: string; copyCode: string },
  actor: Actor,
) {
  const now = new Date();
  const memberId = new Types.ObjectId(verifyCardToken(input.memberToken, libraryId));
  const summary = await memberSummary(libraryId, memberId, now);
  if (!summary.canBorrow) {
    throw new AppError(409, 'BORROW_BLOCKED', summary.blockedReason!, {
      reason: summary.blockedReason,
    });
  }

  const copy = await copyByCode(input.copyCode);
  let reservationId: Types.ObjectId | null = null;
  if (copy.status === 'reserved') {
    const hold = await ReservationModel.findOne({ copyId: copy._id, status: 'ready' }).lean();
    if (!hold || String(hold.memberId) !== String(memberId)) {
      throw new AppError(409, 'COPY_HELD', 'This copy is held for another member’s reservation');
    }
    reservationId = hold._id;
  } else if (copy.status !== 'available') {
    throw new AppError(409, 'COPY_NOT_AVAILABLE', `This copy is ${copy.status}`);
  }

  const claimed = await BookCopyModel.findOneAndUpdate(
    { _id: copy._id, status: copy.status },
    { $set: { status: 'issued' } },
  );
  if (!claimed) throw new AppError(409, 'COPY_NOT_AVAILABLE', 'This copy was just issued');

  await applyDuePlanChanges(new Date(), memberId);
  const profile = await MemberProfileModel.findOne({ userId: memberId }).select('planId').lean();
  const plan = await MembershipPlanModel.findById(profile!.planId).select('finePerDay').lean();
  const { loanDays } = await circulationSettings(libraryId);

  let loan;
  try {
    loan = await LoanModel.create({
      copyId: copy._id,
      bookId: copy.bookId,
      memberId,
      issuedBy: new Types.ObjectId(actor.id),
      issuedAt: now,
      dueAt: new Date(now.getTime() + loanDays * DAY_MS),
      finePerDay: plan?.finePerDay ?? 0,
    });
  } catch (err) {
    await BookCopyModel.updateOne({ _id: copy._id }, { $set: { status: copy.status } });
    if (isDuplicateKey(err))
      throw new AppError(409, 'COPY_NOT_AVAILABLE', 'This copy is already on loan');
    throw err;
  }

  if (reservationId) {
    await ReservationModel.updateOne({ _id: reservationId }, { $set: { status: 'fulfilled' } });
  }
  await BookModel.updateOne({ _id: copy.bookId }, { $inc: { borrowCount: 1 } });
  const [dto] = await toLoanDtos([loan], now);
  await recordAudit({
    libraryId,
    actor,
    action: 'loan.issued',
    target: { type: 'loan', id: loan._id },
    details: {
      copyCode: copy.qrCode,
      bookTitle: dto!.bookTitle,
      memberId: String(memberId),
      dueAt: dto!.dueAt,
    },
  });
  return dto!;
}

/** Looks up a scanned copy before return: its active loan and the fine due now. */
export async function copyStatus(code: string) {
  const copy = await copyByCode(code);
  const book = await BookModel.findById(copy.bookId).select('title').lean();
  const loan = await LoanModel.findOne({ copyId: copy._id, status: 'active' }).lean();
  return {
    copyCode: copy.qrCode,
    bookTitle: book?.title ?? '',
    status: copy.status,
    activeLoan: loan ? (await toLoanDtos([loan]))[0]! : null,
  };
}

/** FR-16: return a copy; late fines are computed automatically (TC-06). */
export async function returnCopy(
  libraryId: string,
  input: { copyCode: string; condition: 'ok' | 'damaged'; damageCharge?: number; note?: string },
  actor: Actor,
): Promise<ReturnResultDto> {
  const now = new Date();
  const copy = await copyByCode(input.copyCode);
  const loan = await LoanModel.findOne({ copyId: copy._id, status: 'active' });
  if (!loan) throw new AppError(409, 'NO_ACTIVE_LOAN', 'This copy is not on loan');

  const late = overdueDays(loan.dueAt, now);
  loan.set({
    status: 'returned',
    returnedAt: now,
    returnedTo: new Types.ObjectId(actor.id),
    fineAmount: late * loan.finePerDay,
    damageCharge: input.condition === 'damaged' ? (input.damageCharge ?? 0) : 0,
    chargeNote: input.condition === 'damaged' ? (input.note ?? 'Returned damaged') : null,
  });
  await loan.save();

  let heldFor: string | null = null;
  if (input.condition === 'damaged') {
    await BookCopyModel.updateOne({ _id: copy._id }, { $set: { status: 'damaged' } });
  } else {
    heldFor = await holdCopyForNextReservation(libraryId, copy._id, copy.bookId, now);
  }

  const [dto] = await toLoanDtos([loan], now);
  await recordAudit({
    libraryId,
    actor,
    action: 'loan.returned',
    target: { type: 'loan', id: loan._id },
    details: {
      copyCode: copy.qrCode,
      overdueDays: late,
      fineAmount: loan.fineAmount,
      damageCharge: loan.damageCharge,
      condition: input.condition,
    },
  });

  // A new due starts the reminder cycle (warning 1 goes out now).
  if (loan.fineAmount + loan.damageCharge > 0) await onDueCreated(libraryId, loan.memberId, now);
  return { loan: dto!, heldFor };
}

/** Marks a borrowed copy as lost and charges the library's lost-book fee. */
export async function markLost(libraryId: string, loanId: string, actor: Actor) {
  const now = new Date();
  const loan = await LoanModel.findOne({ _id: parseId(loanId, 'Loan'), status: 'active' });
  if (!loan) throw notFound('Active loan');
  const { lostBookCharge } = await circulationSettings(libraryId);
  const late = overdueDays(loan.dueAt, now);
  loan.set({
    status: 'lost',
    returnedAt: now,
    returnedTo: new Types.ObjectId(actor.id),
    fineAmount: late * loan.finePerDay,
    damageCharge: lostBookCharge,
    chargeNote: 'Book lost',
  });
  await loan.save();
  await BookCopyModel.updateOne({ _id: loan.copyId }, { $set: { status: 'lost' } });
  await onDueCreated(libraryId, loan.memberId, now);
  await recordAudit({
    libraryId,
    actor,
    action: 'loan.lost',
    target: { type: 'loan', id: loan._id },
    details: { fineAmount: loan.fineAmount, damageCharge: lostBookCharge },
  });
  return (await toLoanDtos([loan], now))[0]!;
}

/** FR-22: extend a loan by the loan period; members may renew their own loans. */
export async function renew(libraryId: string, loanId: string, actor: Actor) {
  const now = new Date();
  const loan = await LoanModel.findOne({ _id: parseId(loanId, 'Loan'), status: 'active' });
  if (!loan || (actor.role === 'member' && String(loan.memberId) !== actor.id)) {
    throw notFound('Active loan');
  }
  const { loanDays, maxRenewals } = await circulationSettings(libraryId);
  if (loan.dueAt < now)
    throw new AppError(409, 'RENEW_OVERDUE', 'Overdue books cannot be renewed. Please return it.');
  if (loan.renewals >= maxRenewals) {
    throw new AppError(
      409,
      'RENEW_LIMIT',
      `This book has already been renewed ${maxRenewals} time${maxRenewals === 1 ? '' : 's'}`,
    );
  }
  if (
    await ReservationModel.exists({
      bookId: loan.bookId,
      status: 'waiting',
      memberId: { $ne: loan.memberId },
    })
  ) {
    throw new AppError(409, 'RENEW_RESERVED', 'Another member is waiting for this book');
  }
  const dues = await pendingDues(loan.memberId);
  if (dues > 0) throw new AppError(409, 'RENEW_DUES', `Pay the pending ${rupees(dues)} first`);

  loan.dueAt = new Date(loan.dueAt.getTime() + loanDays * DAY_MS);
  loan.renewals += 1;
  loan.reminders = { dueSoonAt: null, overdueAt: null };
  await loan.save();
  await recordAudit({
    libraryId,
    actor,
    action: 'loan.renewed',
    target: { type: 'loan', id: loan._id },
    details: { dueAt: loan.dueAt.toISOString(), renewals: loan.renewals },
  });
  return (await toLoanDtos([loan], now))[0]!;
}

export async function listLoans(filter: {
  status: 'active' | 'overdue' | 'returned' | 'lost';
  q?: string;
}) {
  const now = new Date();
  const query: Record<string, unknown> =
    filter.status === 'overdue'
      ? { status: 'active', dueAt: { $lt: now } }
      : { status: filter.status };
  if (filter.q) {
    const rx = { $regex: filter.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const members = await UserModel.find({
      role: 'member',
      $or: [{ name: rx }, { email: rx }],
    }).distinct('_id');
    query.memberId = { $in: members };
  }
  const loans = await LoanModel.find(query)
    .sort(filter.status === 'returned' ? { returnedAt: -1 } : { dueAt: 1 })
    .limit(200)
    .lean();
  return toLoanDtos(loans, now);
}

export async function memberLoans(memberId: string) {
  const _id = new Types.ObjectId(memberId);
  const [current, history] = await Promise.all([
    LoanModel.find({ memberId: _id, status: 'active' }).sort({ dueAt: 1 }).lean(),
    LoanModel.find({ memberId: _id, status: { $ne: 'active' } })
      .sort({ returnedAt: -1 })
      .limit(100)
      .lean(),
  ]);
  return {
    current: await toLoanDtos(current),
    history: await toLoanDtos(history),
    pendingDues: await pendingDues(_id),
  };
}
