import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'invalid id');

export const copiesBody = z.object({
  count: z.number().int().min(1).max(200),
  branchId: objectId,
  shelf: z.string().trim().max(40).default(''),
});
export type CopiesInput = z.infer<typeof copiesBody>;

export const isbnSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .refine((s) => /^(\d{9}[\dX]|\d{13})$/.test(s), 'must be a 10- or 13-digit ISBN');

const bookFields = {
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  isbn: isbnSchema.nullable().optional(),
  category: z.string().trim().min(1).max(60).default('General'),
  language: z.string().trim().min(1).max(40).default('English'),
  description: z.string().trim().max(5000).default(''),
  publishedYear: z.number().int().min(0).max(3000).nullable().optional(),
  /** an https URL (e.g. from ISBN lookup) or a data URL to upload */
  cover: z.string().max(4_000_000).nullable().optional(),
  ebookUrl: z.url().max(500).nullable().optional(),
};

export const createBookBody = z.object({ ...bookFields, copies: copiesBody.optional() });
export type CreateBookInput = z.infer<typeof createBookBody>;

export const updateBookBody = z.object(bookFields);
export type UpdateBookInput = z.infer<typeof updateBookBody>;

export const updateCopyBody = z.object({
  branchId: objectId.optional(),
  shelf: z.string().trim().max(40).optional(),
  status: z.enum(['available', 'lost', 'damaged']).optional(),
});
export type UpdateCopyInput = z.infer<typeof updateCopyBody>;

export const listBooksQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const importBody = z.object({ csv: z.string().min(1).max(5_000_000) });

export const stickersQuery = z.object({
  bookId: objectId.optional(),
  copyIds: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(objectId).max(500).optional()),
});
