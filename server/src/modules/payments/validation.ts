import { z } from 'zod';
import { PAYMENT_METHODS, PAYMENT_PURPOSES, PAYMENT_STATUSES } from '@libraverse/shared';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'invalid id');

export const chargeBody = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('membership'),
    planId: objectId,
    couponCode: z.string().trim().max(20).optional(),
  }),
  z.object({ purpose: z.literal('fine') }),
]);

export const counterBody = z.intersection(
  chargeBody,
  z.object({
    memberToken: z.string().trim().min(10).max(200),
    method: z.enum(['counterUpi', 'cash']),
  }),
);

export const refundBody = z.object({
  amount: z.number().int().min(1).optional(),
  reason: z.string().trim().min(3).max(300),
});

export const listQuery = z.object({
  status: z.enum(PAYMENT_STATUSES).optional(),
  purpose: z.enum(PAYMENT_PURPOSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  memberId: objectId.optional(),
});
