// Usage: npm run seed:world -w server   (after seed:demo)
// Makes the demo feel lived-in: a bigger Riverside catalogue with a year of
// members, payments, loans, fines, reservations and reviews; a second active
// library on Pro with two branches; one library awaiting approval and one
// suspended, so every Super Admin screen has something to show.
// Refuses to run in production. Safe to re-run: each part is skipped once done.
// Demo addresses end in ".demo", which the mailer never sends to.
import 'dotenv/config';
import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { connectDb, disconnectDb } from '../core/db';
import { putFile } from '../core/storage';
import { runAsSystem, runWithTenant } from '../core/tenant';
import { recordAudit } from '../modules/audit/service';
import { hashPassword } from '../modules/auth/service';
import { PlatformPaymentModel } from '../modules/billing/model';
import { BookModel } from '../modules/books/model';
import { newCopyCode } from '../modules/books/service';
import { BranchModel } from '../modules/branches/model';
import { BookCopyModel } from '../modules/copies/model';
import { CouponModel } from '../modules/coupons/model';
import { DonationModel } from '../modules/donations/model';
import { DepositTransactionModel } from '../modules/dues/model';
import { onDueCreated } from '../modules/dues/service';
import { EventModel } from '../modules/events/model';
import { LibraryModel } from '../modules/libraries/model';
import { LoanModel } from '../modules/loans/model';
import { MemberProfileModel } from '../modules/members/model';
import { MembershipPlanModel } from '../modules/membershipPlans/model';
import { PaymentModel } from '../modules/payments/model';
import { PlatformPlanModel } from '../modules/platformPlans/model';
import { ensureDefaultPlans } from '../modules/platformPlans/service';
import { ReservationModel } from '../modules/reservations/model';
import { ReviewModel } from '../modules/reviews/model';
import { SubscriptionModel } from '../modules/subscriptions/model';
import { UserModel } from '../modules/users/model';

const PASSWORD = 'Demo-pass1';
const DAY = 86_400_000;
const NOW = Date.now();
const ago = (days: number, hour = 11) => {
  const d = new Date(NOW - days * DAY);
  d.setHours(hour, randomInt(0, 60), 0, 0);
  return d;
};

// Seeded randomness, so a fresh database always gets the same story.
let seed = 20260930;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

// [title, author, category, language, year, isbn, copies]
type BookRow = [string, string, string, string, number, string | null, number];
const CATALOGUE: BookRow[] = [
  ['The God of Small Things', 'Arundhati Roy', 'Fiction', 'English', 1997, '9780679457312', 2],
  ['A Suitable Boy', 'Vikram Seth', 'Fiction', 'English', 1993, '9780060786526', 1],
  ['Midnight’s Children', 'Salman Rushdie', 'Fiction', 'English', 1981, '9780812976533', 2],
  ['The White Tiger', 'Aravind Adiga', 'Fiction', 'English', 2008, '9781416562603', 2],
  ['The Palace of Illusions', 'Chitra Banerjee Divakaruni', 'Fiction', 'English', 2008, null, 2],
  ['Train to Pakistan', 'Khushwant Singh', 'Fiction', 'English', 1956, null, 1],
  ['The Namesake', 'Jhumpa Lahiri', 'Fiction', 'English', 2003, '9780618485222', 2],
  ['Swami and Friends', 'R. K. Narayan', 'Children', 'English', 1935, null, 2],
  ['The Blue Umbrella', 'Ruskin Bond', 'Children', 'English', 1980, null, 3],
  ['Panchatantra Tales', 'Vishnu Sharma', 'Children', 'English', 2010, null, 2],
  ['Gitanjali', 'Rabindranath Tagore', 'Poetry', 'English', 1910, null, 1],
  ['Madhushala', 'Harivansh Rai Bachchan', 'Poetry', 'Hindi', 1935, null, 1],
  ['Gunahon Ka Devta', 'Dharamvir Bharati', 'Fiction', 'Hindi', 1949, null, 1],
  ['Raag Darbari', 'Shrilal Shukla', 'Fiction', 'Hindi', 1968, null, 1],
  ['Samskara', 'U. R. Ananthamurthy', 'Fiction', 'Kannada', 1965, null, 1],
  ['Parva', 'S. L. Bhyrappa', 'Fiction', 'Kannada', 1979, null, 1],
  ['Karvalo', 'K. P. Poornachandra Tejaswi', 'Fiction', 'Kannada', 1980, null, 1],
  ['Ignited Minds', 'A. P. J. Abdul Kalam', 'Biography', 'English', 2002, null, 2],
  ['The Story of My Experiments with Truth', 'M. K. Gandhi', 'Biography', 'English', 1927, null, 2],
  ['Steve Jobs', 'Walter Isaacson', 'Biography', 'English', 2011, '9781451648539', 1],
  ['Becoming', 'Michelle Obama', 'Biography', 'English', 2018, '9781524763138', 1],
  ['Atomic Habits', 'James Clear', 'Self-help', 'English', 2018, '9780735211292', 3],
  ['Thinking, Fast and Slow', 'Daniel Kahneman', 'Psychology', 'English', 2011, '9780374533557', 1],
  ['The Psychology of Money', 'Morgan Housel', 'Finance', 'English', 2020, '9780857197689', 2],
  ['Rich Dad Poor Dad', 'Robert T. Kiyosaki', 'Finance', 'English', 1997, null, 2],
  ['Guns, Germs, and Steel', 'Jared Diamond', 'History', 'English', 1997, '9780393317558', 1],
  ['The Argumentative Indian', 'Amartya Sen', 'History', 'English', 2005, null, 1],
  ['Cosmos', 'Carl Sagan', 'Science', 'English', 1980, '9780345539434', 1],
  ['The Gene: An Intimate History', 'Siddhartha Mukherjee', 'Science', 'English', 2016, null, 1],
  ['The Emperor of All Maladies', 'Siddhartha Mukherjee', 'Science', 'English', 2010, null, 1],
  [
    'Introduction to Algorithms',
    'Thomas H. Cormen',
    'Computing',
    'English',
    2009,
    '9780262033848',
    2,
  ],
  ['The Pragmatic Programmer', 'Andrew Hunt', 'Computing', 'English', 1999, '9780201616224', 1],
  ['Design Patterns', 'Erich Gamma', 'Computing', 'English', 1994, '9780201633610', 1],
  ['Operating System Concepts', 'Abraham Silberschatz', 'Computing', 'English', 2018, null, 2],
  ['Database System Concepts', 'Abraham Silberschatz', 'Computing', 'English', 2019, null, 2],
  [
    'Harry Potter and the Philosopher’s Stone',
    'J. K. Rowling',
    'Children',
    'English',
    1997,
    null,
    3,
  ],
  ['The Alchemist', 'Paulo Coelho', 'Fiction', 'English', 1988, '9780062315007', 2],
  ['To Kill a Mockingbird', 'Harper Lee', 'Fiction', 'English', 1960, '9780061120084', 1],
  ['1984', 'George Orwell', 'Fiction', 'English', 1949, '9780451524935', 2],
  ['Pride and Prejudice', 'Jane Austen', 'Fiction', 'English', 1813, null, 1],
];

const FIRST = [
  'Priya',
  'Rahul',
  'Ananya',
  'Vikram',
  'Sneha',
  'Karthik',
  'Divya',
  'Rohan',
  'Aishwarya',
  'Siddharth',
  'Pooja',
  'Nikhil',
  'Kavya',
  'Aditya',
  'Meghana',
  'Harsha',
  'Shreya',
  'Varun',
  'Lakshmi',
  'Manoj',
  'Neha',
  'Suresh',
  'Ritu',
  'Pranav',
  'Tanvi',
  'Abhishek',
  'Bhavana',
  'Kiran',
  'Deepa',
  'Yash',
  'Anjali',
  'Gautam',
] as const;
const LAST = [
  'Sharma',
  'Reddy',
  'Iyer',
  'Patil',
  'Gowda',
  'Menon',
  'Kulkarni',
  'Rao',
  'Hegde',
  'Joshi',
  'Nair',
  'Shetty',
  'Bhat',
  'Desai',
  'Pillai',
  'Verma',
  'Kamath',
  'Naidu',
] as const;
const REVIEWS = [
  [5, 'Could not put it down. Borrowing it again next month!'],
  [5, 'A must-read. The library copy is in great condition too.'],
  [4, 'Really enjoyed it, a little slow in the middle.'],
  [4, 'Good read for the weekend.'],
  [4, 'Clear and practical. Recommended it to my friends.'],
  [3, 'Decent, but I expected more after all the hype.'],
  [5, 'Beautifully written.'],
  [4, 'Helped a lot with my exam preparation.'],
] as const;

interface Plan {
  _id: Types.ObjectId;
  name: string;
  price: number;
  durationDays: number;
  bookLimit: number;
  finePerDay: number;
  tier: 'member' | 'gold' | 'premium' | 'elite';
}
interface Staff {
  _id: Types.ObjectId;
  role: 'libraryAdmin' | 'librarian';
}
interface Ctx {
  libraryId: Types.ObjectId;
  slug: string;
  owner: Staff;
  staff: Staff[];
  plans: Plan[];
  deposit: number; // paise
  loanDays: number;
  idProofKey: string;
  hash: string;
  usedNames: Set<string>;
  usedNumbers: Set<string>;
  audits: {
    at: Date;
    actor: Staff;
    action: string;
    target: { type: string; id: Types.ObjectId };
  }[];
}

function membershipNo(ctx: Ctx) {
  let n: string;
  do {
    n = String(int(1, 9));
    for (let i = 0; i < 15; i++) n += String(int(0, 9));
  } while (ctx.usedNumbers.has(n));
  ctx.usedNumbers.add(n);
  return n;
}

function newName(ctx: Ctx) {
  for (;;) {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    if (!ctx.usedNames.has(name)) {
      ctx.usedNames.add(name);
      return name;
    }
  }
}

const receiptNo = (slug: string, id: Types.ObjectId, paidAt: Date) =>
  `${slug.slice(0, 6).toUpperCase()}-${paidAt.toISOString().slice(0, 10).replace(/-/g, '')}-${String(id).slice(-6).toUpperCase()}`;

/** A confirmed payment, as the app would have stored it. */
async function paid(
  ctx: Ctx,
  p: {
    memberId: Types.ObjectId;
    purpose: 'membership' | 'fine' | 'deposit';
    amount: number;
    at: Date;
    planId?: Types.ObjectId;
    loanIds?: Types.ObjectId[];
    method?: 'cash' | 'online' | 'counterUpi';
    discount?: number;
    couponCode?: string | null;
  },
) {
  const method = p.method ?? (chance(0.45) ? 'cash' : chance(0.6) ? 'online' : 'counterUpi');
  const _id = new Types.ObjectId();
  const collector = method === 'online' ? null : pick(ctx.staff);
  const ref = String(_id).slice(-10);
  await PaymentModel.create({
    _id,
    memberId: p.memberId,
    purpose: p.purpose,
    method,
    amount: p.amount,
    discount: p.discount ?? 0,
    couponCode: p.couponCode ?? null,
    planId: p.planId ?? null,
    loanIds: p.loanIds ?? [],
    status: 'success',
    expiresAt: new Date(p.at.getTime() + 15 * 60_000),
    paidAt: p.at,
    razorpayOrderId: method === 'cash' ? null : `order_seed${ref}`,
    razorpayPaymentId: method === 'cash' ? null : `pay_seed${ref}`,
    receiptNo: receiptNo(ctx.slug, _id, p.at),
    collectedBy: collector?._id ?? null,
    history: [
      { status: 'created', at: p.at, source: 'seed' },
      { status: 'success', at: p.at, source: method === 'online' ? 'webhook' : 'counter' },
    ],
    createdAt: p.at,
    updatedAt: p.at,
  });
  if (method === 'cash' && collector) {
    ctx.audits.push({
      at: p.at,
      actor: collector,
      action: 'payment.cash',
      target: { type: 'payment', id: _id },
    });
  }
  return _id;
}

type Kind = 'active' | 'expired' | 'pending' | 'rejected' | 'refund';

/** One member with a believable history: joining, renewals, deposit. */
async function member(ctx: Ctx, kind: Kind, joinedDaysAgo: number) {
  const name = newName(ctx);
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@${ctx.slug}.demo`;
  const joined = ago(joinedDaysAgo, int(9, 19));
  const user = await UserModel.create({
    name,
    email,
    role: 'member',
    status: 'active',
    passwordHash: ctx.hash,
    createdAt: joined,
  });
  const phone = `+91 9${int(100000000, 999999999)}`;
  const base = {
    userId: user._id,
    phone,
    idProofKey: ctx.idProofKey,
    idSubmittedAt: joined,
    termsAcceptedAt: joined,
    createdAt: joined,
  };
  if (kind === 'pending') {
    await MemberProfileModel.create(base);
    return { user, plan: null, active: false, kind, joinedDaysAgo };
  }
  if (kind === 'rejected') {
    await MemberProfileModel.create({
      ...base,
      verificationStatus: 'rejected',
      verificationNote: 'The ID photo is blurred. Please upload a clearer copy.',
      verifiedBy: ctx.owner._id,
      verifiedAt: ago(joinedDaysAgo - 1),
    });
    return { user, plan: null, active: false, kind, joinedDaysAgo };
  }

  const verifier = pick(ctx.staff);
  const approvedAt = new Date(joined.getTime() + int(2, 20) * 3_600_000);
  // Expired members were on the shortest plan and stopped renewing a while ago.
  const plan =
    kind === 'expired'
      ? [...ctx.plans].sort((a, b) => a.durationDays - b.durationDays)[0]!
      : pick(ctx.plans);
  const stopAt = kind === 'expired' ? NOW - int(8, 40) * DAY : NOW;
  const more = (t: number) =>
    kind === 'expired' ? t + plan.durationDays * DAY <= stopAt : t < stopAt;
  let t = approvedAt.getTime() + int(0, 2) * 3_600_000;
  let first = true;
  let periodStart = t;
  while (more(t)) {
    const at = new Date(t);
    const coupon = first && chance(0.2);
    const discount = coupon ? Math.round(plan.price * 0.1) : 0;
    await paid(ctx, {
      memberId: user._id,
      purpose: 'membership',
      amount: plan.price - discount,
      discount,
      couponCode: coupon ? 'WELCOME10' : null,
      at,
      planId: plan._id,
    });
    if (first) {
      // The security deposit, collected at the counter with the first plan.
      const depId = await paid(ctx, {
        memberId: user._id,
        purpose: 'deposit',
        amount: ctx.deposit,
        at,
        method: 'cash',
      });
      await DepositTransactionModel.create({
        memberId: user._id,
        type: 'collected',
        amount: ctx.deposit,
        balanceAfter: ctx.deposit,
        reason: 'Security deposit paid with membership',
        paymentId: depId,
        idempotencyKey: `collected:${String(depId)}`,
        createdAt: at,
      });
    }
    first = false;
    periodStart = t;
    t += plan.durationDays * DAY;
  }

  await MemberProfileModel.create({
    ...base,
    verificationStatus: 'approved',
    verifiedBy: verifier._id,
    verifiedAt: approvedAt,
    membershipNo: membershipNo(ctx),
    planId: plan._id,
    validTill: new Date(t),
    currentPeriodStart: new Date(periodStart),
    cardTier: plan.tier,
    cardRevealedAt: approvedAt,
    depositBalance: ctx.deposit,
    depositCollectedAt: approvedAt,
    ...(kind === 'refund'
      ? {
          depositRefund: {
            status: 'requested',
            requestedAt: ago(2, 18),
            requestedBy: 'member',
            reason: 'Moving to Pune for work next month.',
          },
        }
      : {}),
  });
  if (joinedDaysAgo <= 21) {
    ctx.audits.push({
      at: approvedAt,
      actor: verifier,
      action: 'member.approved',
      target: { type: 'user', id: user._id },
    });
  }
  return { user, plan, active: kind !== 'expired', kind, joinedDaysAgo };
}

/** Titles and copies for the catalogue; returns copy handles per book. */
async function catalogue(ctx: Ctx, rows: BookRow[], branchIds: Types.ObjectId[]) {
  const books: { _id: Types.ObjectId; copies: Types.ObjectId[] }[] = [];
  for (const [i, [title, author, category, language, year, isbn, count]] of rows.entries()) {
    const book = await BookModel.create({
      title,
      authors: [author],
      category,
      language,
      publishedYear: year,
      isbn,
      createdAt: ago(rows.length - i + 20),
    });
    const copies: Types.ObjectId[] = [];
    for (let c = 0; c < count; c++) {
      const copy = await BookCopyModel.create({
        bookId: book._id,
        branchId: branchIds[c % branchIds.length],
        shelf: `${category.slice(0, 3).toUpperCase()}-${int(1, 12)}`,
        qrCode: newCopyCode(),
      });
      copies.push(copy._id);
    }
    books.push({ _id: book._id, copies });
  }
  return books;
}

/** Past loans (with fines, mostly paid), current loans, reviews and holds. */
async function circulation(
  ctx: Ctx,
  members: Awaited<ReturnType<typeof member>>[],
  books: Awaited<ReturnType<typeof catalogue>>,
) {
  const borrowers = members.filter((m) => m.plan);
  const busy = new Set<string>(); // copies out right now
  const reviewed = new Set<string>();
  const ratings = new Map<string, number[]>();
  const borrowCounts = new Map<string, number>();
  const bump = (bookId: Types.ObjectId) =>
    borrowCounts.set(String(bookId), (borrowCounts.get(String(bookId)) ?? 0) + 1);
  let unpaidDueMember: Types.ObjectId | null = null;

  for (const m of borrowers) {
    const plan = m.plan!;
    // History: 2 to 7 returned loans across the last ~11 weeks.
    for (let k = int(2, 7); k > 0; k--) {
      const book = pick(books);
      const copyId = pick(book.copies);
      const latest = m.active ? 16 : 50;
      const earliest = Math.min(78, m.joinedDaysAgo - 1);
      if (earliest < latest) break;
      const issuedDaysAgo = int(latest, earliest);
      const issuedAt = ago(issuedDaysAgo, int(10, 19));
      const dueAt = new Date(issuedAt.getTime() + ctx.loanDays * DAY);
      const lateDays = chance(0.18) ? int(1, 6) : 0;
      const returnedAt = new Date(
        (lateDays
          ? dueAt.getTime() + lateDays * DAY
          : issuedAt.getTime() + int(3, ctx.loanDays) * DAY) +
          int(1, 5) * 3_600_000,
      );
      if (returnedAt.getTime() > NOW) continue;
      const fine = lateDays * plan.finePerDay;
      const staff = pick(ctx.staff);
      const loanId = new Types.ObjectId();
      const unpaid = fine > 0 && !unpaidDueMember && m.active && issuedDaysAgo < 40;
      let paymentId: Types.ObjectId | null = null;
      if (fine > 0 && !unpaid) {
        paymentId = await paid(ctx, {
          memberId: m.user._id,
          purpose: 'fine',
          amount: fine,
          at: returnedAt,
          loanIds: [loanId],
        });
      }
      await LoanModel.create({
        _id: loanId,
        copyId,
        bookId: book._id,
        memberId: m.user._id,
        issuedBy: staff._id,
        issuedAt,
        dueAt,
        returnedAt,
        returnedTo: pick(ctx.staff)._id,
        status: 'returned',
        renewals: chance(0.15) ? 1 : 0,
        finePerDay: plan.finePerDay,
        fineAmount: fine,
        duesPaidAmount: paymentId ? fine : 0,
        duesPaidAt: paymentId ? returnedAt : null,
        duesPaymentId: paymentId,
        createdAt: issuedAt,
      });
      bump(book._id);
      if (unpaid) unpaidDueMember = m.user._id;
      if (!reviewed.has(`${String(book._id)}:${String(m.user._id)}`) && chance(0.35)) {
        const [rating, text] = pick(REVIEWS);
        reviewed.add(`${String(book._id)}:${String(m.user._id)}`);
        await ReviewModel.create({
          bookId: book._id,
          memberId: m.user._id,
          rating,
          text,
          createdAt: new Date(returnedAt.getTime() + DAY),
        });
        ratings.set(String(book._id), [...(ratings.get(String(book._id)) ?? []), rating]);
      }
      if (issuedDaysAgo <= 14) {
        ctx.audits.push({
          at: issuedAt,
          actor: staff,
          action: 'loan.issued',
          target: { type: 'loan', id: loanId },
        });
        ctx.audits.push({
          at: returnedAt,
          actor: staff,
          action: 'loan.returned',
          target: { type: 'loan', id: loanId },
        });
      }
    }

    // Right now: most active members have one or two books out; a few are late.
    // A member asking for their deposit back has returned everything.
    if (!m.active || m.kind === 'refund' || !chance(0.65)) continue;
    for (let k = Math.min(plan.bookLimit, int(1, 2)); k > 0; k--) {
      const book = pick(books);
      const copyId = book.copies.find((c) => !busy.has(String(c)));
      if (!copyId) continue;
      busy.add(String(copyId));
      // Never before they joined (loans start the day after at the earliest).
      const maxAgo = m.joinedDaysAgo - 1;
      const overdue = chance(0.12) && maxAgo > ctx.loanDays + 1;
      const issuedDaysAgo = overdue
        ? Math.min(maxAgo, ctx.loanDays + int(1, 5))
        : int(0, Math.max(0, Math.min(maxAgo, ctx.loanDays - 2)));
      const issuedAt = ago(issuedDaysAgo, int(10, 18));
      const staff = pick(ctx.staff);
      const loan = await LoanModel.create({
        copyId,
        bookId: book._id,
        memberId: m.user._id,
        issuedBy: staff._id,
        issuedAt,
        dueAt: new Date(issuedAt.getTime() + ctx.loanDays * DAY),
        status: 'active',
        finePerDay: plan.finePerDay,
        createdAt: issuedAt,
      });
      await BookCopyModel.updateOne({ _id: copyId }, { status: 'issued' });
      bump(book._id);
      if (issuedDaysAgo <= 14) {
        ctx.audits.push({
          at: issuedAt,
          actor: staff,
          action: 'loan.issued',
          target: { type: 'loan', id: loan._id },
        });
      }
    }
  }

  // Holds: a waiting list on a title whose copies are all out, and one ready to collect.
  const readers = borrowers.filter((m) => m.active);
  const allOut = books.find((b) => b.copies.every((c) => busy.has(String(c))));
  if (allOut && readers.length > 2) {
    for (const m of readers.slice(0, 2)) {
      await ReservationModel.create({
        bookId: allOut._id,
        memberId: m.user._id,
        createdAt: ago(int(1, 4)),
      });
    }
  }
  const free = books.find((b) => b.copies.some((c) => !busy.has(String(c))) && b !== allOut);
  const collector = readers.at(-1);
  if (free && collector) {
    const copyId = free.copies.find((c) => !busy.has(String(c)))!;
    await BookCopyModel.updateOne({ _id: copyId }, { status: 'reserved' });
    await ReservationModel.create({
      bookId: free._id,
      memberId: collector.user._id,
      status: 'ready',
      copyId,
      readyAt: ago(1, 10),
      holdUntil: new Date(NOW + 2 * DAY),
      createdAt: ago(5),
    });
  }
  for (const m of readers.slice(2, 5)) {
    await ReservationModel.create({
      bookId: pick(books)._id,
      memberId: m.user._id,
      status: pick(['fulfilled', 'fulfilled', 'cancelled', 'expired'] as const),
      createdAt: ago(int(20, 60)),
    });
  }

  for (const [bookId, count] of borrowCounts) {
    const r = ratings.get(bookId) ?? [];
    await BookModel.updateOne(
      { _id: bookId },
      {
        $inc: { borrowCount: count },
        ...(r.length
          ? {
              $set: {
                ratingAvg: Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10,
                ratingCount: r.length,
              },
            }
          : {}),
      },
    );
  }
  // Wishlists, and one member whose late fine is still unpaid (dues warnings start).
  for (const m of readers) {
    const wish = [
      ...new Set([pick(books), pick(books), pick(books)].slice(0, int(0, 3)).map((b) => b._id)),
    ];
    if (wish.length) await MemberProfileModel.updateOne({ userId: m.user._id }, { wishlist: wish });
  }
  if (unpaidDueMember) await onDueCreated(String(ctx.libraryId), unpaidDueMember, ago(2));
}

async function writeAudits(ctx: Ctx) {
  ctx.audits.sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const a of ctx.audits) {
    await recordAudit({
      libraryId: ctx.libraryId,
      actor: { id: a.actor._id, role: a.actor.role },
      action: a.action,
      target: a.target,
      details: { at: a.at.toISOString(), seeded: true },
    });
  }
}

async function makeContext(
  libraryId: Types.ObjectId,
  slug: string,
  owner: Staff,
  staff: Staff[],
  deposit: number,
  loanDays: number,
  hash: string,
): Promise<Ctx> {
  const idProof = await putFile(
    {
      // A real PNG (storage services reject fake image bytes).
      data: await QRCode.toBuffer('LibraVerse demo ID proof (not a real document)', { width: 480 }),
      mime: 'image/png',
    },
    `id-proofs/${String(libraryId)}`,
    'private',
  );
  const plans = (await MembershipPlanModel.find({ active: true }).lean()) as unknown as Plan[];
  const existing = await MemberProfileModel.find({ membershipNo: { $ne: null } })
    .select('membershipNo')
    .lean();
  const names = await UserModel.find().select('name').lean();
  return {
    libraryId,
    slug,
    owner,
    staff,
    plans,
    deposit,
    loanDays,
    idProofKey: idProof.key,
    hash,
    usedNames: new Set(names.map((n) => n.name)),
    usedNumbers: new Set(existing.map((p) => p.membershipNo!)),
    audits: [],
  };
}

async function people(ctx: Ctx, mix: [Kind, number][]) {
  const out = [];
  for (const [kind, n] of mix) {
    for (let i = 0; i < n; i++) {
      const days =
        kind === 'pending'
          ? int(0, 3)
          : kind === 'rejected'
            ? int(3, 9)
            : kind === 'expired'
              ? int(90, 330)
              : int(10, 330);
      out.push(await member(ctx, kind, days));
    }
  }
  return out;
}

/**
 * seed:demo created Meera "today" with a Gold card and a loan from 17 days
 * ago; give her the past that implies: joined months back, two paid Gold
 * periods and the deposit that came with the first.
 */
async function meerasHistory(ctx: Ctx) {
  const meera = await UserModel.findOne({ email: 'member@riverside.demo' }).lean();
  const profile = meera && (await MemberProfileModel.findOne({ userId: meera._id }).lean());
  if (!meera || !profile?.validTill || !profile.planId) return;
  if (await PaymentModel.exists({ memberId: meera._id })) return;
  const plan = ctx.plans.find((p) => String(p._id) === String(profile.planId));
  if (!plan) return;
  const secondStart = new Date(profile.validTill.getTime() - plan.durationDays * DAY);
  const firstStart = new Date(secondStart.getTime() - plan.durationDays * DAY);
  const joined = new Date(firstStart.getTime() - DAY);
  // createdAt is immutable in Mongoose; this one-off backdate is deliberate.
  const backdate = { timestamps: false, overwriteImmutable: true } as const;
  await UserModel.updateOne({ _id: meera._id }, { $set: { createdAt: joined } }, backdate);
  await MemberProfileModel.updateOne(
    { _id: profile._id },
    {
      $set: {
        createdAt: joined,
        idSubmittedAt: joined,
        termsAcceptedAt: joined,
        verifiedAt: firstStart,
        cardRevealedAt: firstStart,
        currentPeriodStart: secondStart,
        depositCollectedAt: firstStart,
      },
    },
    backdate,
  );
  await paid(ctx, {
    memberId: meera._id,
    purpose: 'membership',
    amount: plan.price,
    at: firstStart,
    planId: plan._id,
    method: 'online',
  });
  const depId = await paid(ctx, {
    memberId: meera._id,
    purpose: 'deposit',
    amount: profile.depositBalance,
    at: firstStart,
    method: 'cash',
  });
  await DepositTransactionModel.create({
    memberId: meera._id,
    type: 'collected',
    amount: profile.depositBalance,
    balanceAfter: profile.depositBalance,
    reason: 'Security deposit paid with membership',
    paymentId: depId,
    idempotencyKey: `collected:${String(depId)}`,
    createdAt: firstStart,
  });
  await paid(ctx, {
    memberId: meera._id,
    purpose: 'membership',
    amount: plan.price,
    at: secondStart,
    planId: plan._id,
    method: 'online',
  });
}

/** Riverside already exists (seed:demo); give it depth once. */
async function enrichRiverside(hash: string) {
  const lib = await LibraryModel.findOne({ slug: 'riverside' }).lean();
  if (!lib) throw new Error('Run npm run seed:demo -w server first');
  await runWithTenant(lib._id, async () => {
    if (await BookModel.exists({ title: 'The God of Small Things' })) {
      console.log('Riverside is already filled in.');
      return;
    }
    const owner = await UserModel.findOne({ role: 'libraryAdmin' }).orFail().lean();
    const librarian = await UserModel.findOne({ role: 'librarian' }).orFail().lean();
    const branch = await BranchModel.findOne().orFail().lean();
    const second = await BranchModel.create({
      name: 'Indiranagar branch',
      address: '100 Feet Road, Indiranagar, Bengaluru',
    });
    await BranchModel.updateOne({ _id: branch._id }, { address: 'MG Road, Bengaluru' });
    const staff: Staff[] = [
      { _id: owner._id, role: 'libraryAdmin' },
      { _id: librarian._id, role: 'librarian' },
    ];
    const ctx = await makeContext(
      lib._id,
      'riverside',
      staff[0]!,
      staff,
      lib.circulation?.depositAmount ?? 50_000,
      lib.circulation?.loanDays ?? 14,
      hash,
    );
    await meerasHistory(ctx);
    const books = await catalogue(ctx, CATALOGUE.slice(0, 32), [branch._id, second._id]);
    const members = await people(ctx, [
      ['active', 17],
      ['expired', 3],
      ['refund', 1],
      ['pending', 2],
      ['rejected', 1],
    ]);
    await circulation(ctx, members, books);
    await EventModel.create([
      {
        kind: 'event',
        title: 'Author talk: writing for young readers',
        date: new Date(NOW + 9 * DAY),
        description: 'Join us on Saturday at 5 pm in the reading hall. Free entry for members.',
        createdBy: owner._id,
      },
      {
        kind: 'event',
        title: 'Book club: “The God of Small Things”',
        date: new Date(NOW + 16 * DAY),
        description: 'Second Sunday of the month, 11 am. Copies are on hold at the front desk.',
        createdBy: owner._id,
      },
      {
        kind: 'announcement',
        title: 'New arrivals in Computing',
        description: 'Twelve new titles for exam season are on the Computing shelf.',
        createdBy: librarian._id,
      },
    ]);
    await DonationModel.create([
      {
        donorName: 'Rohit Shenoy',
        donorEmail: 'rohit@example.com',
        title: 'Sapiens',
        author: 'Yuval Noah Harari',
        condition: 'good',
        message: 'Hope someone enjoys it as much as I did.',
        status: 'accepted',
      },
      {
        donorName: 'Anonymous',
        donorEmail: 'anon@example.com',
        anonymous: true,
        title: 'Old encyclopedia set',
        author: '',
        condition: 'worn',
        status: 'declined',
        staffNote: 'Too damaged for lending.',
      },
      {
        donorName: 'Farah Khan',
        donorEmail: 'farah@example.com',
        title: 'The Hungry Tide',
        author: 'Amitav Ghosh',
        condition: 'new',
        status: 'offered',
      },
    ]);
    await writeAudits(ctx);
    console.log(
      `Riverside: +${books.length} titles, +${members.length} members, a year of payments and loans.`,
    );
  });
}

/** A second active library on Pro, with two branches. */
async function saraswati(hash: string) {
  if (await LibraryModel.exists({ slug: 'saraswati' })) {
    console.log('Saraswati Public Library already exists.');
    return;
  }
  const pro = await PlatformPlanModel.findOne({ code: 'pro' }).orFail();
  const lib = await LibraryModel.create({
    name: 'Saraswati Public Library',
    slug: 'saraswati',
    ownerName: 'Suresh Hegde',
    contactEmail: 'owner@saraswati.demo',
    status: 'active',
    cardColours: ['#1e3a8a', '#0f172a'],
    circulation: {
      loanDays: 21,
      maxRenewals: 2,
      holdDays: 3,
      lostBookCharge: 40_000,
      depositAmount: 30_000,
      warningIntervalDays: 3,
      deductionGraceDays: 4,
    },
    createdAt: ago(160),
  });
  // Pro since registration: one paid month at a time.
  for (let m = 5; m >= 0; m--) {
    const at = ago(m * 30 + 10, 15);
    await PlatformPaymentModel.create({
      billedLibraryId: lib._id,
      platformPlanId: pro._id,
      purpose: m === 5 ? 'registration' : 'upgrade',
      amount: pro.monthlyPrice,
      status: 'success',
      expiresAt: new Date(at.getTime() + 15 * 60_000),
      razorpayOrderId: `order_seedpro${m}`,
      razorpayPaymentId: `pay_seedpro${m}`,
      paidAt: at,
      history: [{ status: 'success', at, source: 'webhook' }],
      createdAt: at,
    });
  }
  await runWithTenant(lib._id, async () => {
    await SubscriptionModel.create({
      platformPlanId: pro._id,
      status: 'active',
      currentPeriodEnd: new Date(NOW + 20 * DAY),
    });
    const [north, south] = await BranchModel.create([
      { name: 'Saraswathipuram (main)', address: '8th Cross, Saraswathipuram, Mysuru' },
      { name: 'Kuvempunagar', address: 'Kuvempunagar Double Road, Mysuru' },
    ]);
    const owner = await UserModel.create({
      name: 'Suresh Hegde',
      email: 'owner@saraswati.demo',
      role: 'libraryAdmin',
      status: 'active',
      passwordHash: hash,
    });
    const lakshmi = await UserModel.create({
      name: 'Lakshmi Bhat',
      email: 'librarian@saraswati.demo',
      role: 'librarian',
      status: 'active',
      passwordHash: hash,
      branchId: north!._id,
    });
    const naveen = await UserModel.create({
      name: 'Naveen Gowda',
      email: 'naveen@saraswati.demo',
      role: 'librarian',
      status: 'active',
      passwordHash: hash,
      branchId: south!._id,
    });
    await MembershipPlanModel.create([
      {
        name: 'Basic',
        price: 9_900,
        durationDays: 30,
        bookLimit: 2,
        finePerDay: 200,
        tier: 'member',
      },
      {
        name: 'Reader',
        price: 29_900,
        durationDays: 90,
        bookLimit: 4,
        finePerDay: 200,
        tier: 'gold',
      },
      {
        name: 'Scholar',
        price: 99_900,
        durationDays: 365,
        bookLimit: 6,
        finePerDay: 100,
        tier: 'premium',
      },
    ]);
    await CouponModel.create([
      { code: 'WELCOME10', discountPercent: 10, validTill: new Date(NOW + 365 * DAY) },
      { code: 'DASARA20', discountPercent: 20, validTill: new Date(NOW + 20 * DAY) },
    ]);
    const staff: Staff[] = [
      { _id: owner._id, role: 'libraryAdmin' },
      { _id: lakshmi._id, role: 'librarian' },
      { _id: naveen._id, role: 'librarian' },
    ];
    const ctx = await makeContext(lib._id, 'saraswati', staff[0]!, staff, 30_000, 21, hash);
    const books = await catalogue(ctx, [...CATALOGUE.slice(10, 40)], [north!._id, south!._id]);
    const members = await people(ctx, [
      ['active', 14],
      ['expired', 2],
      ['pending', 1],
    ]);
    await circulation(ctx, members, books);
    await EventModel.create([
      {
        kind: 'event',
        title: 'Kannada Rajyotsava poetry reading',
        date: new Date(NOW + 12 * DAY),
        description: 'Members read their favourite Kannada poems. 4 pm, main branch.',
        createdBy: owner._id,
      },
      {
        kind: 'announcement',
        title: 'Kuvempunagar branch timings',
        description: 'Open 10 am to 7 pm, closed on Tuesdays.',
        createdBy: naveen._id,
      },
    ]);
    await writeAudits(ctx);
    console.log(
      `Saraswati Public Library: ${books.length} titles, ${members.length} members, Pro plan.`,
    );
  });
}

/** Libraries the Super Admin still has to act on. */
async function otherLibraries(hash: string) {
  const free = await PlatformPlanModel.findOne({ code: 'free' }).orFail();
  if (!(await LibraryModel.exists({ slug: 'st-josephs' }))) {
    const lib = await LibraryModel.create({
      name: 'St. Joseph’s College Library',
      slug: 'st-josephs',
      ownerName: 'Fr. Thomas D’Souza',
      contactEmail: 'library@stjosephs.demo',
      status: 'pending',
      createdAt: ago(1, 16),
    });
    await runWithTenant(lib._id, async () => {
      await BranchModel.create({ name: 'Main campus', address: 'Lalbagh Road, Bengaluru' });
      await UserModel.create({
        name: 'Fr. Thomas D’Souza',
        email: 'library@stjosephs.demo',
        role: 'libraryAdmin',
        status: 'invited',
      });
      await SubscriptionModel.create({ platformPlanId: free._id, status: 'pending' });
    });
    console.log('St. Joseph’s College Library: waiting for your approval.');
  }
  if (!(await LibraryModel.exists({ slug: 'lakeview' }))) {
    const lib = await LibraryModel.create({
      name: 'Lakeview Community Library',
      slug: 'lakeview',
      ownerName: 'Maria Fernandes',
      contactEmail: 'owner@lakeview.demo',
      status: 'suspended',
      statusReason: 'Closed for renovation until next month, at the owner’s request.',
      createdAt: ago(210),
    });
    await runWithTenant(lib._id, async () => {
      const branch = await BranchModel.create({
        name: 'Main branch',
        address: 'Ulsoor Lake Road, Bengaluru',
      });
      await SubscriptionModel.create({ platformPlanId: free._id, status: 'active' });
      const owner = await UserModel.create({
        name: 'Maria Fernandes',
        email: 'owner@lakeview.demo',
        role: 'libraryAdmin',
        status: 'active',
        passwordHash: hash,
      });
      await MembershipPlanModel.create({
        name: 'Community',
        price: 4_900,
        durationDays: 30,
        bookLimit: 2,
        finePerDay: 100,
        tier: 'member',
      });
      const staff: Staff[] = [{ _id: owner._id, role: 'libraryAdmin' }];
      const ctx = await makeContext(lib._id, 'lakeview', staff[0]!, staff, 20_000, 14, hash);
      await catalogue(ctx, CATALOGUE.slice(20, 28), [branch._id]);
      await people(ctx, [['expired', 4]]);
    });
    console.log('Lakeview Community Library: suspended (renovation).');
  }
}

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('seed:world never runs in production');
  await connectDb(env.MONGODB_URI);
  try {
    await runAsSystem('script:seed-world', async () => {
      await ensureDefaultPlans();
      const hash = await hashPassword(PASSWORD);
      await enrichRiverside(hash);
      await saraswati(hash);
      await otherLibraries(hash);
    });
    console.log(`
New sign-ins (password ${PASSWORD}):
  Saraswati admin      owner@saraswati.demo
  Saraswati librarian  librarian@saraswati.demo
  Members              <first>.<last>@riverside.demo / @saraswati.demo (see Members page)
`);
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
