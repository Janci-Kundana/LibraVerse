import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  BookDetailDto,
  BookDto,
  CopyDto,
  CsvImportResultDto,
  IsbnLookupDto,
  Paged,
} from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { parseCsvObjects } from '../../core/csv';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { decodeDataUrl, putFile } from '../../core/storage';
import { BranchModel } from '../branches/model';
import { BookCopyModel } from '../copies/model';
import { MemberProfileModel } from '../members/model';
import { ReviewModel } from '../reviews/model';
import { BookModel, type Book } from './model';
import {
  isbnSchema,
  type CopiesInput,
  type CreateBookInput,
  type UpdateBookInput,
  type UpdateCopyInput,
} from './validation';

// FR-14. Everything here runs in the librarian's tenant context.

type BookDoc = Book & { _id: Types.ObjectId; createdAt: Date };

export const newCopyCode = () => `LVC-${randomBytes(9).toString('base64url')}`;

/** Copy totals per book: all copies except lost ones, and those on the shelf. */
export async function copyCounts(bookIds: Types.ObjectId[]) {
  const rows: { _id: Types.ObjectId; total: number; available: number }[] =
    await BookCopyModel.aggregate([
      { $match: { bookId: { $in: bookIds }, status: { $ne: 'lost' } } },
      {
        $group: {
          _id: '$bookId',
          total: { $sum: 1 },
          available: { $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] } },
        },
      },
    ]);
  return new Map(rows.map((r) => [String(r._id), { total: r.total, available: r.available }]));
}

export function toBookDto(
  b: BookDoc,
  counts: Map<string, { total: number; available: number }>,
): BookDto {
  return {
    id: String(b._id),
    title: b.title,
    authors: b.authors,
    isbn: b.isbn ?? null,
    category: b.category,
    language: b.language,
    description: b.description,
    publishedYear: b.publishedYear ?? null,
    coverUrl: b.coverUrl ?? null,
    ebookUrl: b.ebookUrl ?? null,
    createdAt: b.createdAt.toISOString(),
    copies: counts.get(String(b._id)) ?? { total: 0, available: 0 },
    ratingAvg: b.ratingAvg ?? null,
    ratingCount: b.ratingCount,
    donatedBy: b.donatedBy ?? null,
  };
}

async function resolveCover(cover: string | null | undefined, libraryId: string) {
  if (cover === undefined) return undefined;
  if (cover === null) return null;
  if (/^https:\/\//.test(cover)) return cover;
  const file = decodeDataUrl(cover, {
    allowed: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 3 * 1024 * 1024,
  });
  return (await putFile(file, `covers/${libraryId}`, 'public')).url;
}

async function assertBranch(branchId: string) {
  if (!(await BranchModel.exists({ _id: parseId(branchId, 'Branch') }))) throw notFound('Branch');
}

const isbnTaken = () =>
  new AppError(409, 'ISBN_TAKEN', 'A book with this ISBN is already in the catalog', {
    field: 'isbn',
  });

export async function addCopies(bookId: Types.ObjectId, input: CopiesInput) {
  await assertBranch(input.branchId);
  const docs = Array.from({ length: input.count }, () => ({
    bookId,
    branchId: new Types.ObjectId(input.branchId),
    shelf: input.shelf,
    qrCode: newCopyCode(),
  }));
  return BookCopyModel.insertMany(docs);
}

export async function createBook(libraryId: string, input: CreateBookInput) {
  const { copies, cover, ...fields } = input;
  if (copies) await assertBranch(copies.branchId);
  let book;
  try {
    book = await BookModel.create({
      ...fields,
      isbn: fields.isbn ?? null,
      coverUrl: (await resolveCover(cover, libraryId)) ?? null,
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw isbnTaken();
    throw err;
  }
  if (copies) await addCopies(book._id, copies);
  return getBook(String(book._id));
}

export async function updateBook(libraryId: string, id: string, input: UpdateBookInput) {
  const { cover, ...fields } = input;
  const coverUrl = await resolveCover(cover, libraryId);
  try {
    const book = await BookModel.findOneAndUpdate(
      { _id: parseId(id, 'Book') },
      { ...fields, isbn: fields.isbn ?? null, ...(coverUrl !== undefined ? { coverUrl } : {}) },
      { new: true, runValidators: true },
    );
    if (!book) throw notFound('Book');
  } catch (err) {
    if (isDuplicateKey(err)) throw isbnTaken();
    throw err;
  }
  return getBook(id);
}

export async function deleteBook(id: string) {
  const _id = parseId(id, 'Book');
  if (await BookCopyModel.exists({ bookId: _id, status: { $in: ['issued', 'reserved'] } })) {
    throw new AppError(409, 'BOOK_IN_USE', 'Some copies are issued or reserved');
  }
  const res = await BookModel.deleteOne({ _id });
  if (res.deletedCount === 0) throw notFound('Book');
  await BookCopyModel.deleteMany({ bookId: _id });
  await ReviewModel.deleteMany({ bookId: _id });
  await MemberProfileModel.updateMany({ wishlist: _id }, { $pull: { wishlist: _id } });
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Title, author or ISBN search, shared by staff and member catalog. */
export function searchFilter(q?: string) {
  if (!q) return {};
  const rx = { $regex: escapeRegex(q), $options: 'i' };
  const isbn = q.replace(/[\s-]/g, '');
  return {
    $or: [{ title: rx }, { authors: rx }, ...(/^\d{5,13}X?$/i.test(isbn) ? [{ isbn }] : [])],
  };
}

export async function listBooks(opts: {
  q?: string;
  category?: string;
  page: number;
  pageSize: number;
}): Promise<Paged<BookDto>> {
  const filter = { ...searchFilter(opts.q), ...(opts.category ? { category: opts.category } : {}) };
  const [books, total] = await Promise.all([
    BookModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((opts.page - 1) * opts.pageSize)
      .limit(opts.pageSize)
      .lean(),
    BookModel.countDocuments(filter),
  ]);
  const counts = await copyCounts(books.map((b) => b._id));
  return {
    items: books.map((b) => toBookDto(b, counts)),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

export async function toCopyDtos(
  copies: {
    _id: Types.ObjectId;
    bookId: Types.ObjectId;
    branchId: Types.ObjectId;
    qrCode: string;
    shelf?: string | null;
    status: CopyDto['status'];
  }[],
): Promise<CopyDto[]> {
  const branches = await BranchModel.find({ _id: { $in: copies.map((c) => c.branchId) } })
    .select('name')
    .lean();
  const names = new Map(branches.map((b) => [String(b._id), b.name]));
  return copies.map((c) => ({
    id: String(c._id),
    bookId: String(c.bookId),
    branchId: String(c.branchId),
    branchName: names.get(String(c.branchId)) ?? null,
    qrCode: c.qrCode,
    shelf: c.shelf ?? '',
    status: c.status,
  }));
}

export async function getBook(id: string): Promise<BookDetailDto> {
  const book = await BookModel.findById(parseId(id, 'Book')).lean();
  if (!book) throw notFound('Book');
  const copies = await BookCopyModel.find({ bookId: book._id }).sort({ createdAt: 1 }).lean();
  const counts = await copyCounts([book._id]);
  return { ...toBookDto(book, counts), copyList: await toCopyDtos(copies) };
}

export async function addCopiesToBook(id: string, input: CopiesInput) {
  const _id = parseId(id, 'Book');
  if (!(await BookModel.exists({ _id }))) throw notFound('Book');
  await addCopies(_id, input);
  return getBook(id);
}

export async function updateCopy(id: string, input: UpdateCopyInput) {
  const copy = await BookCopyModel.findById(parseId(id, 'Copy'));
  if (!copy) throw notFound('Copy');
  if (input.status && ['issued', 'reserved'].includes(copy.status)) {
    throw new AppError(409, 'COPY_IN_USE', `This copy is ${copy.status}; return it first`);
  }
  if (input.branchId) {
    await assertBranch(input.branchId);
    copy.branchId = new Types.ObjectId(input.branchId);
  }
  if (input.shelf !== undefined) copy.shelf = input.shelf;
  if (input.status) copy.status = input.status;
  await copy.save();
  return (await toCopyDtos([copy]))[0]!;
}

export async function deleteCopy(id: string) {
  const copy = await BookCopyModel.findById(parseId(id, 'Copy')).lean();
  if (!copy) throw notFound('Copy');
  if (['issued', 'reserved'].includes(copy.status)) {
    throw new AppError(409, 'COPY_IN_USE', `This copy is ${copy.status}`);
  }
  await BookCopyModel.deleteOne({ _id: copy._id });
}

/** Looks a book up on Open Library for ISBN auto-fill. */
export async function lookupIsbn(raw: string): Promise<IsbnLookupDto> {
  const parsed = isbnSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, 'INVALID_ISBN', 'Enter a 10- or 13-digit ISBN');
  const isbn = parsed.data;

  let data: Record<string, unknown>;
  try {
    const res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'LibraVerse/1.0' } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AppError(
      502,
      'LOOKUP_FAILED',
      'Could not reach Open Library. Fill the details by hand.',
    );
  }

  const entry = data[`ISBN:${isbn}`] as
    | {
        title?: string;
        authors?: { name: string }[];
        publish_date?: string;
        subjects?: { name: string }[];
        cover?: { large?: string; medium?: string };
        notes?: string | { value: string };
      }
    | undefined;
  if (!entry?.title) throw new AppError(404, 'NOT_FOUND', 'No book found for that ISBN');

  const year = entry.publish_date?.match(/\d{4}/)?.[0];
  const cover = entry.cover?.large ?? entry.cover?.medium ?? null;
  return {
    isbn,
    title: entry.title,
    authors: (entry.authors ?? []).map((a) => a.name),
    publishedYear: year ? Number(year) : null,
    category: entry.subjects?.[0]?.name ?? null,
    coverUrl: cover ? cover.replace(/^http:/, 'https:') : null,
    description: typeof entry.notes === 'string' ? entry.notes : (entry.notes?.value ?? ''),
  };
}

const MAX_IMPORT_ROWS = 2000;

/**
 * Bulk CSV import. Columns: title (required), authors (";"-separated), isbn,
 * category, language, publishedYear, copies (default 1), shelf, branch (name;
 * default the first branch). A row whose ISBN is already catalogued adds copies.
 */
export async function importCsv(csv: string): Promise<CsvImportResultDto> {
  const rows = parseCsvObjects(csv);
  if (rows.length === 0) throw new AppError(400, 'EMPTY_CSV', 'The CSV has no data rows');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new AppError(400, 'CSV_TOO_LARGE', `Import at most ${MAX_IMPORT_ROWS} rows at a time`);
  }
  if (!('title' in rows[0]!))
    throw new AppError(400, 'CSV_HEADER', 'The CSV needs a "title" column');

  const branches = await BranchModel.find().sort({ createdAt: 1 }).lean();
  const branchByName = new Map(branches.map((b) => [b.name.toLowerCase(), b._id]));
  const result: CsvImportResultDto = { created: 0, copiesCreated: 0, errors: [] };

  for (const [i, row] of rows.entries()) {
    const rowNo = i + 2; // 1-based, after the header
    try {
      if (!row.title) throw new Error('title is required');
      const isbn = row.isbn ? isbnSchema.parse(row.isbn) : null;
      const count = row.copies ? Number(row.copies) : 1;
      if (!Number.isInteger(count) || count < 0 || count > 200)
        throw new Error('copies must be 0-200');
      const branchId = row.branch ? branchByName.get(row.branch.toLowerCase()) : branches[0]?._id;
      if (!branchId) throw new Error(`unknown branch "${row.branch}"`);
      const year = row.publishedyear ? Number(row.publishedyear) : null;

      let book = isbn ? await BookModel.findOne({ isbn }) : null;
      if (!book) {
        book = await BookModel.create({
          title: row.title.slice(0, 300),
          authors: (row.authors ?? '')
            .split(';')
            .map((a) => a.trim())
            .filter(Boolean),
          isbn,
          category: row.category || 'General',
          language: row.language || 'English',
          publishedYear: year && Number.isInteger(year) ? year : null,
        });
        result.created++;
      }
      if (count > 0) {
        await addCopies(book._id, { count, branchId: String(branchId), shelf: row.shelf ?? '' });
        result.copiesCreated += count;
      }
    } catch (err) {
      const message =
        err instanceof Error && 'issues' in err
          ? 'isbn must be a 10- or 13-digit ISBN'
          : err instanceof Error
            ? err.message
            : 'invalid row';
      result.errors.push({ row: rowNo, message });
    }
  }
  return result;
}
