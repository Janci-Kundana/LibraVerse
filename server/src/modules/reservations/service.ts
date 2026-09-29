import { Types } from 'mongoose';
import type { ReservationDto, ReservationStatus } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { notify } from '../../core/notify';
import { BookModel } from '../books/model';
import { DAY_MS, circulationSettings, membershipStatus } from '../circulation/rules';
import { BookCopyModel } from '../copies/model';
import { LoanModel } from '../loans/model';
import { MemberProfileModel } from '../members/model';
import { UserModel } from '../users/model';
import { ReservationModel, type Reservation } from './model';

// FR-18/19: the hold queue. Tenant context.

type ReservationDoc = Reservation & { _id: Types.ObjectId; createdAt: Date };

export async function toReservationDtos(list: ReservationDoc[]): Promise<ReservationDto[]> {
  const [books, users, copies] = await Promise.all([
    BookModel.find({ _id: { $in: list.map((r) => r.bookId) } })
      .select('title')
      .lean(),
    UserModel.find({ _id: { $in: list.map((r) => r.memberId) } })
      .select('name')
      .lean(),
    BookCopyModel.find({ _id: { $in: list.map((r) => r.copyId).filter(Boolean) } })
      .select('qrCode')
      .lean(),
  ]);
  const title = new Map(books.map((b) => [String(b._id), b.title]));
  const name = new Map(users.map((u) => [String(u._id), u.name]));
  const code = new Map(copies.map((c) => [String(c._id), c.qrCode]));

  return Promise.all(
    list.map(async (r) => ({
      id: String(r._id),
      bookId: String(r.bookId),
      bookTitle: title.get(String(r.bookId)) ?? 'Removed book',
      memberName: name.get(String(r.memberId)) ?? 'Member',
      status: r.status,
      position:
        r.status === 'waiting'
          ? (await ReservationModel.countDocuments({
              bookId: r.bookId,
              status: 'waiting',
              createdAt: { $lt: r.createdAt },
            })) + 1
          : null,
      holdUntil: r.holdUntil ? r.holdUntil.toISOString() : null,
      copyCode: r.copyId ? (code.get(String(r.copyId)) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

/**
 * A copy has come back on the shelf. Holds it for the first member waiting for
 * the book (TC-09), or makes it available. Returns the member's name if held.
 */
export async function holdCopyForNextReservation(
  libraryId: string,
  copyId: Types.ObjectId,
  bookId: Types.ObjectId,
  now = new Date(),
): Promise<string | null> {
  const { holdDays, libraryName } = await circulationSettings(libraryId);
  const holdUntil = new Date(now.getTime() + holdDays * DAY_MS);
  const next = await ReservationModel.findOneAndUpdate(
    { bookId, status: 'waiting' },
    { $set: { status: 'ready', copyId, readyAt: now, holdUntil } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!next) {
    await BookCopyModel.updateOne({ _id: copyId }, { $set: { status: 'available' } });
    return null;
  }
  await BookCopyModel.updateOne({ _id: copyId }, { $set: { status: 'reserved' } });

  const [member, book] = await Promise.all([
    UserModel.findById(next.memberId).select('name email').lean(),
    BookModel.findById(bookId).select('title').lean(),
  ]);
  if (member) {
    await notify(
      { libraryId, userId: String(next.memberId), email: member.email },
      {
        type: 'reservation.ready',
        subject: `"${book?.title}" is ready for you`,
        text: `Hi ${member.name},\n\nThe book you reserved, "${book?.title}", is waiting for you at ${libraryName}. We will hold it until ${holdUntil.toLocaleDateString('en-IN')}. Bring your membership card to collect it.`,
      },
    );
  }
  return member?.name ?? null;
}

export async function reserve(memberId: string, bookId: string) {
  const member = new Types.ObjectId(memberId);
  const book = await BookModel.findById(parseId(bookId, 'Book')).select('title').lean();
  if (!book) throw notFound('Book');

  const profile = await MemberProfileModel.findOne({ userId: member }).lean();
  if (!profile || membershipStatus(profile) !== 'active') {
    throw new AppError(409, 'NO_MEMBERSHIP', 'You need an active membership to reserve books');
  }
  if (await LoanModel.exists({ memberId: member, bookId: book._id, status: 'active' })) {
    throw new AppError(409, 'ALREADY_BORROWED', 'You already have this book');
  }
  if (await BookCopyModel.exists({ bookId: book._id, status: 'available' })) {
    throw new AppError(
      409,
      'COPIES_AVAILABLE',
      'A copy is on the shelf now. Ask at the counter to borrow it.',
    );
  }
  try {
    const r = await ReservationModel.create({ bookId: book._id, memberId: member });
    return (await toReservationDtos([r]))[0]!;
  } catch (err) {
    if (isDuplicateKey(err))
      throw new AppError(409, 'ALREADY_RESERVED', 'You have already reserved this book');
    throw err;
  }
}

async function release(
  libraryId: string,
  r: { copyId?: Types.ObjectId | null; bookId: Types.ObjectId },
  now: Date,
) {
  if (r.copyId) await holdCopyForNextReservation(libraryId, r.copyId, r.bookId, now);
}

export async function cancel(libraryId: string, memberId: string, id: string) {
  const r = await ReservationModel.findOneAndUpdate(
    {
      _id: parseId(id, 'Reservation'),
      memberId: new Types.ObjectId(memberId),
      status: { $in: ['waiting', 'ready'] },
    },
    { $set: { status: 'cancelled' } },
  ).lean();
  if (!r) throw notFound('Reservation');
  if (r.status === 'ready') await release(libraryId, r, new Date());
}

/** Holds nobody collected in time: expire them and pass the copy on. */
export async function expireHolds(libraryId: string, now = new Date()) {
  const due = await ReservationModel.find({ status: 'ready', holdUntil: { $lt: now } }).lean();
  for (const r of due) {
    const updated = await ReservationModel.updateOne(
      { _id: r._id, status: 'ready' },
      { $set: { status: 'expired' } },
    );
    if (updated.modifiedCount === 1) await release(libraryId, r, now);
  }
  return due.length;
}

export async function listForMember(memberId: string) {
  const list = await ReservationModel.find({
    memberId: new Types.ObjectId(memberId),
    status: { $in: ['waiting', 'ready'] },
  })
    .sort({ createdAt: 1 })
    .lean();
  return toReservationDtos(list);
}

export async function listForStaff(status: ReservationStatus) {
  const list = await ReservationModel.find({ status })
    .sort({ createdAt: status === 'waiting' || status === 'ready' ? 1 : -1 })
    .limit(200)
    .lean();
  return toReservationDtos(list);
}
