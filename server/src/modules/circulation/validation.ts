import { z } from 'zod';
import { RESERVATION_STATUSES } from '@libraverse/shared';

const token = z.string().trim().min(10).max(200);
const code = z.string().trim().min(3).max(60);

export const scanBody = z.object({ memberToken: token });
export const issueBody = z.object({ memberToken: token, copyCode: code });
export const returnBody = z.object({
  copyCode: code,
  condition: z.enum(['ok', 'damaged']).default('ok'),
  damageCharge: z.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});
export const loansQuery = z.object({
  status: z.enum(['active', 'overdue', 'returned', 'lost']).default('active'),
  q: z.string().trim().max(100).optional(),
});
export const reservationsQuery = z.object({
  status: z.enum(RESERVATION_STATUSES).default('waiting'),
});
export const reserveBody = z.object({ bookId: z.string().regex(/^[a-f\d]{24}$/i) });
