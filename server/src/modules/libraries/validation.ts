import { z } from 'zod';
import { LIBRARY_STATUSES, PLATFORM_PLAN_CODES } from '@libraverse/shared';

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, numbers and single hyphens only');

export const registerLibraryBody = z.object({
  libraryName: z.string().trim().min(2).max(100),
  slug: slugSchema.optional(),
  ownerName: z.string().trim().min(2).max(100),
  ownerEmail: z.email().trim().toLowerCase(),
  planCode: z.enum(PLATFORM_PLAN_CODES),
  branchName: z.string().trim().min(1).max(100).optional(),
});
export type RegisterLibraryInput = z.infer<typeof registerLibraryBody>;

export const LIBRARY_ACTIONS = ['approve', 'reject', 'suspend', 'reactivate'] as const;
export type LibraryAction = (typeof LIBRARY_ACTIONS)[number];

export const libraryActionBody = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const listLibrariesQuery = z.object({
  status: z.enum(LIBRARY_STATUSES).optional(),
});
