import { Types } from 'mongoose';
import type {
  CatalogBookDetailDto,
  CatalogBookDto,
  CatalogFacetsDto,
  Paged,
  ReviewDto,
} from '@libraverse/shared';
import { notFound, parseId } from '../../core/ids';
import { copyCounts, searchFilter, toBookDto } from '../books/service';
import { BookModel } from '../books/model';
import { BranchModel } from '../branches/model';
import { BookCopyModel } from '../copies/model';
import { MemberProfileModel } from '../members/model';
import { ReviewModel } from '../reviews/model';
import { UserModel } from '../users/model';
import type { SearchQuery } from './validation';

// FR-19: members search, filter, review and wishlist books. Tenant context of
// a verified member.

const SORTS = {
  new: { createdAt: -1 },
  popular: { borrowCount: -1, createdAt: -1 },
  rating: { ratingAvg: -1, ratingCount: -1 },
  title: { title: 1 },
} as const;

async function wishlistOf(userId: string): Promise<Set<string>> {
  const profile = await MemberProfileModel.findOne({ userId: new Types.ObjectId(userId) })
    .select('wishlist')
    .lean();
  return new Set((profile?.wishlist ?? []).map(String));
}

export async function search(userId: string, q: SearchQuery): Promise<Paged<CatalogBookDto>> {
  const filter: Record<string, unknown> = {
    ...searchFilter(q.q),
    ...(q.category ? { category: q.category } : {}),
    ...(q.language ? { language: q.language } : {}),
  };
  if (q.available) {
    filter._id = { $in: await BookCopyModel.distinct('bookId', { status: 'available' }) };
  }
  const [books, total, wishlist] = await Promise.all([
    BookModel.find(filter)
      .sort(SORTS[q.sort])
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    BookModel.countDocuments(filter),
    wishlistOf(userId),
  ]);
  const counts = await copyCounts(books.map((b) => b._id));
  return {
    items: books.map((b) => ({ ...toBookDto(b, counts), inWishlist: wishlist.has(String(b._id)) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function facets(): Promise<CatalogFacetsDto> {
  const [categories, languages] = await Promise.all([
    BookModel.distinct('category'),
    BookModel.distinct('language'),
  ]);
  return { categories: categories.sort(), languages: languages.sort() };
}

async function reviewsFor(bookId: Types.ObjectId, userId: string): Promise<ReviewDto[]> {
  const reviews = await ReviewModel.find({ bookId }).sort({ createdAt: -1 }).limit(50).lean();
  const users = await UserModel.find({ _id: { $in: reviews.map((r) => r.memberId) } })
    .select('name')
    .lean();
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  return reviews.map((r) => ({
    id: String(r._id),
    // First name only: reviews are visible to every member of the library.
    memberName: (names.get(String(r.memberId)) ?? 'Member').split(' ')[0]!,
    rating: r.rating,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    mine: String(r.memberId) === userId,
  }));
}

export async function detail(userId: string, id: string): Promise<CatalogBookDetailDto> {
  const book = await BookModel.findById(parseId(id, 'Book')).lean();
  if (!book) throw notFound('Book');
  const [counts, wishlist, reviews, byBranch] = await Promise.all([
    copyCounts([book._id]),
    wishlistOf(userId),
    reviewsFor(book._id, userId),
    BookCopyModel.aggregate<{ _id: Types.ObjectId; available: number }>([
      { $match: { bookId: book._id, status: 'available' } },
      { $group: { _id: '$branchId', available: { $sum: 1 } } },
    ]),
  ]);
  const branches = await BranchModel.find({ _id: { $in: byBranch.map((b) => b._id) } })
    .select('name')
    .lean();
  const names = new Map(branches.map((b) => [String(b._id), b.name]));
  return {
    ...toBookDto(book, counts),
    inWishlist: wishlist.has(String(book._id)),
    reviews,
    availability: byBranch.map((b) => ({
      branchName: names.get(String(b._id)) ?? 'Branch',
      available: b.available,
    })),
  };
}

async function refreshRating(bookId: Types.ObjectId) {
  const [agg] = await ReviewModel.aggregate<{ avg: number; count: number }>([
    { $match: { bookId } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  await BookModel.updateOne(
    { _id: bookId },
    {
      $set: {
        ratingAvg: agg ? Math.round(agg.avg * 10) / 10 : null,
        ratingCount: agg?.count ?? 0,
      },
    },
  );
}

export async function upsertReview(
  userId: string,
  id: string,
  input: { rating: number; text: string },
) {
  const bookId = parseId(id, 'Book');
  if (!(await BookModel.exists({ _id: bookId }))) throw notFound('Book');
  await ReviewModel.findOneAndUpdate(
    { bookId, memberId: new Types.ObjectId(userId) },
    { $set: input },
    { upsert: true, runValidators: true },
  );
  await refreshRating(bookId);
  return detail(userId, id);
}

export async function deleteReview(userId: string, id: string) {
  const bookId = parseId(id, 'Book');
  await ReviewModel.deleteOne({ bookId, memberId: new Types.ObjectId(userId) });
  await refreshRating(bookId);
}

export async function setWishlisted(userId: string, id: string, on: boolean) {
  const bookId = parseId(id, 'Book');
  if (on && !(await BookModel.exists({ _id: bookId }))) throw notFound('Book');
  await MemberProfileModel.updateOne(
    { userId: new Types.ObjectId(userId) },
    on ? { $addToSet: { wishlist: bookId } } : { $pull: { wishlist: bookId } },
  );
}

export async function wishlist(userId: string): Promise<CatalogBookDto[]> {
  const ids = [...(await wishlistOf(userId))].map((id) => new Types.ObjectId(id));
  const books = await BookModel.find({ _id: { $in: ids } })
    .sort({ title: 1 })
    .lean();
  const counts = await copyCounts(books.map((b) => b._id));
  return books.map((b) => ({ ...toBookDto(b, counts), inWishlist: true }));
}
