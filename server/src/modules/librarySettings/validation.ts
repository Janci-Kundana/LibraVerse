import { z } from 'zod';

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a colour like #c0263a');

export const updateSettingsBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  cardColours: z.array(hexColour).max(3).optional(),
  /** data URL to replace the logo, or null to remove it */
  logo: z.string().max(4_000_000).nullable().optional(),
  circulation: z
    .object({
      loanDays: z.number().int().min(1).max(180),
      maxRenewals: z.number().int().min(0).max(10),
      holdDays: z.number().int().min(1).max(30),
      lostBookCharge: z.number().int().min(0).max(10_000_000),
      depositAmount: z.number().int().min(100, 'the deposit must be at least ₹1').max(10_000_000),
      warningIntervalDays: z.number().int().min(1).max(30).default(3),
      deductionGraceDays: z.number().int().min(2).max(60).default(4),
    })
    .optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsBody>;
