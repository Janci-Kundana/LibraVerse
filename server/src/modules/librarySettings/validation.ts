import { z } from 'zod';

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be a colour like #c0263a');

export const updateSettingsBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  cardColours: z.array(hexColour).max(3).optional(),
  /** data URL to replace the logo, or null to remove it */
  logo: z.string().max(4_000_000).nullable().optional(),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsBody>;
