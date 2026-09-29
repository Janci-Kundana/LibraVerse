import { z } from 'zod';

export const couponBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,20}$/, '3-20 letters, numbers, - or _'),
  discountPercent: z.number().int().min(1).max(100),
  validTill: z.coerce.date(),
  active: z.boolean().default(true),
});
export type CouponInput = z.infer<typeof couponBody>;
