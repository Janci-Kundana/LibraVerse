import { notify } from '../core/notify';
import { runWithTenant } from '../core/tenant';
import { BookModel } from '../modules/books/model';
import { DAY_MS, overdueDays, rupees } from '../modules/circulation/rules';
import { LoanModel } from '../modules/loans/model';
import { MemberProfileModel } from '../modules/members/model';
import { expireHolds } from '../modules/reservations/service';
import { UserModel } from '../modules/users/model';

// FR-28. Each job handles one library inside its tenant context; the scheduler
// loops over active libraries. `now` is a parameter so tests can move time.

const DUE_SOON_DAYS = 2;
const EXPIRY_NOTICE_DAYS = 7;

async function recipients(userIds: unknown[]) {
  const users = await UserModel.find({ _id: { $in: userIds }, status: 'active' })
    .select('name email')
    .lean();
  return new Map(users.map((u) => [String(u._id), u]));
}

async function titles(bookIds: unknown[]) {
  const books = await BookModel.find({ _id: { $in: bookIds } })
    .select('title')
    .lean();
  return new Map(books.map((b) => [String(b._id), b.title]));
}

/** Due in the next 2 days: one reminder per loan period. Overdue: at most one a day. */
export function sendLoanReminders(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, async () => {
    const dueSoon = await LoanModel.find({
      status: 'active',
      dueAt: { $gte: now, $lte: new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS) },
      'reminders.dueSoonAt': null,
    }).lean();
    const overdue = await LoanModel.find({
      status: 'active',
      dueAt: { $lt: now },
      $or: [
        { 'reminders.overdueAt': null },
        { 'reminders.overdueAt': { $lte: new Date(now.getTime() - DAY_MS) } },
      ],
    }).lean();

    const all = [...dueSoon, ...overdue];
    const [people, books] = await Promise.all([
      recipients(all.map((l) => l.memberId)),
      titles(all.map((l) => l.bookId)),
    ]);

    for (const loan of dueSoon) {
      const m = people.get(String(loan.memberId));
      if (!m) continue;
      await notify(
        { libraryId, userId: String(loan.memberId), email: m.email },
        {
          type: 'loan.dueSoon',
          subject: `"${books.get(String(loan.bookId))}" is due on ${loan.dueAt.toLocaleDateString('en-IN')}`,
          text: `Hi ${m.name},\n\nA reminder that "${books.get(String(loan.bookId))}" is due on ${loan.dueAt.toLocaleDateString('en-IN')}. Return or renew it in LibraVerse to avoid a late fine.`,
        },
      );
      await LoanModel.updateOne({ _id: loan._id }, { $set: { 'reminders.dueSoonAt': now } });
    }

    for (const loan of overdue) {
      const m = people.get(String(loan.memberId));
      if (!m) continue;
      const days = overdueDays(loan.dueAt, now);
      await notify(
        { libraryId, userId: String(loan.memberId), email: m.email },
        {
          type: 'loan.overdue',
          subject: `"${books.get(String(loan.bookId))}" is ${days} day${days > 1 ? 's' : ''} overdue`,
          text: `Hi ${m.name},\n\n"${books.get(String(loan.bookId))}" was due on ${loan.dueAt.toLocaleDateString('en-IN')}. The late fine so far is ${rupees(days * loan.finePerDay)} and grows by ${rupees(loan.finePerDay)} a day. Please return it soon.`,
        },
      );
      await LoanModel.updateOne({ _id: loan._id }, { $set: { 'reminders.overdueAt': now } });
    }
    return { dueSoon: dueSoon.length, overdue: overdue.length };
  });
}

/** Memberships ending within 7 days get one reminder. */
export function sendExpiryReminders(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, async () => {
    const expiring = await MemberProfileModel.find({
      validTill: { $gte: now, $lte: new Date(now.getTime() + EXPIRY_NOTICE_DAYS * DAY_MS) },
      expiryReminderAt: null,
    }).lean();
    const people = await recipients(expiring.map((p) => p.userId));
    for (const p of expiring) {
      const m = people.get(String(p.userId));
      if (!m) continue;
      await notify(
        { libraryId, userId: String(p.userId), email: m.email },
        {
          type: 'membership.expiring',
          subject: `Your membership ends on ${p.validTill!.toLocaleDateString('en-IN')}`,
          text: `Hi ${m.name},\n\nYour library membership ends on ${p.validTill!.toLocaleDateString('en-IN')}. Renew it in LibraVerse to keep borrowing.`,
        },
      );
      await MemberProfileModel.updateOne({ _id: p._id }, { $set: { expiryReminderAt: now } });
    }
    return expiring.length;
  });
}

export function expireReservationHolds(libraryId: string, now = new Date()) {
  return runWithTenant(libraryId, () => expireHolds(libraryId, now));
}
