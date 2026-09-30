import { z } from 'zod';
import { passwordSchema } from '../auth/validation';

const idProof = z.string().max(8_000_000, 'ID proof must be under 5 MB');

export const joinBody = z.object({
  librarySlug: z.string().trim().toLowerCase().min(3).max(40),
  name: z.string().trim().min(2).max(100),
  email: z.email().trim().toLowerCase(),
  password: passwordSchema,
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s-]{7,20}$/, 'must be a phone number')
    .optional(),
  idProof,
  /** card photo (data URL), required: staff compare it with the ID proof */
  photo: z
    .string({ error: 'Add a clear photo of your face for your card' })
    .min(1, 'Add a clear photo of your face for your card')
    .max(3_000_000, 'Photo must be under 2 MB'),
  acceptTerms: z.literal(true, { error: 'You must accept the library rules' }),
});
export type JoinInput = z.infer<typeof joinBody>;

export const resubmitIdBody = z.object({ idProof });

export const photoBody = z.object({ photo: z.string().min(1).max(3_000_000) });

export const rejectBody = z.object({ reason: z.string().trim().min(3).max(500) });

export const verificationQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
