import { z } from 'zod';
import { CARD_TIERS } from '@libraverse/shared';

const paise = z.number().int().min(0).max(100_000_000);

export const membershipPlanBody = z.object({
  name: z.string().trim().min(1).max(60),
  price: paise,
  durationDays: z.number().int().min(1).max(3650),
  bookLimit: z.number().int().min(0).max(100),
  finePerDay: paise,
  tier: z.enum(CARD_TIERS).default('member'),
  active: z.boolean().default(true),
});
export type MembershipPlanInput = z.infer<typeof membershipPlanBody>;
