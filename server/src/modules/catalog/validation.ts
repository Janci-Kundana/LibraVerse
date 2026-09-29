import { z } from 'zod';

export const CATALOG_SORTS = ['new', 'popular', 'rating', 'title'] as const;

export const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  language: z.string().trim().max(40).optional(),
  available: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(CATALOG_SORTS).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuery>;

export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).default(''),
});
