import { Types } from 'mongoose';
import { z } from 'zod';
import type { Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { notFound, parseId } from '../../core/ids';
import { sendMail } from '../../core/mailer';
import { runWithTenant } from '../../core/tenant';
import { recordAudit } from '../audit/service';
import { BookModel } from '../books/model';
import { addCopies } from '../books/service';
import { LibraryModel } from '../libraries/model';
import { MemberProfileModel } from '../members/model';
import { DonationModel } from './model';

// FR-03 / FR-18 / TC-11: offer → accept or decline → catalogue with "Donated by".

type Actor = { id: string; role: Role };

export const offerBody = z.object({
  donorName: z.string().trim().min(2).max(100),
  donorEmail: z.email().trim().toLowerCase(),
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).default(''),
  condition: z.enum(['new', 'good', 'fair', 'worn']),
  message: z.string().trim().max(1000).default(''),
  anonymous: z.boolean().default(false),
});

export const decideBody = z.object({ note: z.string().trim().max(500).optional() });

export const catalogueBody = z.object({
  category: z.string().trim().min(1).max(60).default('General'),
  language: z.string().trim().min(1).max(40).default('English'),
  copies: z.object({
    count: z.number().int().min(1).max(20),
    branchId: z.string().regex(/^[a-f\d]{24}$/i),
    shelf: z.string().trim().max(40).default(''),
  }),
});

const toDto = (d: { _id: Types.ObjectId; createdAt: Date } & Record<string, unknown>) => ({
  id: String(d._id),
  donorName: d.donorName as string,
  donorEmail: d.donorEmail as string,
  anonymous: d.anonymous as boolean,
  isMember: d.memberId != null,
  title: d.title as string,
  author: d.author as string,
  condition: d.condition as string,
  message: d.message as string,
  status: d.status as string,
  staffNote: (d.staffNote as string | null) ?? null,
  bookId: d.bookId ? String(d.bookId) : null,
  createdAt: d.createdAt.toISOString(),
});
export type DonationDto = ReturnType<typeof toDto>;

/** Public (or a signed-in member of this library) offers a book. */
export async function offer(
  slug: string,
  input: z.infer<typeof offerBody>,
  memberId: string | null,
) {
  const library = await LibraryModel.findOne({ slug, status: 'active' }).select('name').lean();
  if (!library) throw notFound('Library');
  return runWithTenant(library._id, async () => {
    const d = await DonationModel.create({
      ...input,
      memberId: memberId ? new Types.ObjectId(memberId) : null,
    });
    await sendMail({
      to: input.donorEmail,
      subject: `Thank you for offering "${input.title}" to ${library.name}`,
      text: `Hi ${input.donorName},\n\nWe received your offer of "${input.title}". The library staff will review it and email you.`,
    });
    return toDto(d.toObject());
  });
}

export async function list(status?: string) {
  const docs = await DonationModel.find(status ? { status } : {})
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return docs.map((d) => toDto(d));
}

export async function decide(
  libraryId: string,
  id: string,
  accept: boolean,
  note: string | undefined,
  actor: Actor,
) {
  const d = await DonationModel.findOneAndUpdate(
    { _id: parseId(id, 'Donation'), status: 'offered' },
    { $set: { status: accept ? 'accepted' : 'declined', staffNote: note ?? null } },
    { new: true },
  ).lean();
  if (!d) throw new AppError(409, 'ALREADY_DECIDED', 'This offer was already handled');
  await recordAudit({
    libraryId,
    actor,
    action: accept ? 'donation.accepted' : 'donation.declined',
    target: { type: 'donation', id: d._id },
    details: { title: d.title },
  });
  const library = await LibraryModel.findById(libraryId).select('name').lean();
  await sendMail({
    to: d.donorEmail,
    subject: accept
      ? `${library?.name} would love your book`
      : `About your book offer to ${library?.name}`,
    text: accept
      ? `Hi ${d.donorName},\n\nWe accepted your offer of "${d.title}". Please drop it at the library counter.${note ? `\n\n${note}` : ''}`
      : `Hi ${d.donorName},\n\nThank you for offering "${d.title}". We are unable to accept it this time.${note ? `\n\n${note}` : ''}`,
  });
  return toDto(d);
}

/** The book has arrived: add it to the catalog with the donor's credit. */
export async function catalogue(
  libraryId: string,
  id: string,
  input: z.infer<typeof catalogueBody>,
  actor: Actor,
) {
  const d = await DonationModel.findOne({ _id: parseId(id, 'Donation'), status: 'accepted' });
  if (!d) throw new AppError(409, 'NOT_ACCEPTED', 'Only accepted offers can be catalogued');
  const book = await BookModel.create({
    title: d.title,
    authors: d.author ? [d.author] : [],
    category: input.category,
    language: input.language,
    donationId: d._id,
    donatedBy: d.anonymous ? 'Anonymous' : d.donorName,
  });
  await addCopies(book._id, input.copies);
  d.set({ status: 'catalogued', bookId: book._id });
  await d.save();
  if (d.memberId) {
    await MemberProfileModel.updateOne(
      { userId: d.memberId },
      { $addToSet: { badges: 'contributor' } },
    );
  }
  await recordAudit({
    libraryId,
    actor,
    action: 'donation.catalogued',
    target: { type: 'donation', id: d._id },
    details: { bookId: String(book._id), title: d.title },
  });
  const library = await LibraryModel.findById(libraryId).select('name').lean();
  await sendMail({
    to: d.donorEmail,
    subject: `"${d.title}" is now on the shelves at ${library?.name}`,
    text: `Hi ${d.donorName},\n\nYour book is now in the catalog${d.anonymous ? ' (donated anonymously)' : `, credited "Donated by ${d.donorName}"`}. Thank you!`,
  });
  return { donation: toDto(d.toObject()), bookId: String(book._id) };
}
