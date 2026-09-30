import { z } from 'zod';

const email = z.email().trim().toLowerCase();
const otpCode = z.string().regex(/^\d{6}$/, 'must be a 6-digit code');

export const passwordSchema = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(72, 'must be at most 72 characters') // bcrypt ignores bytes past 72
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/\d/, 'must contain a number');

export const loginBody = z.object({
  email,
  password: z.string().min(1).max(200),
  // undefined = not chosen yet; null = the platform (Super Admin) account
  libraryId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable()
    .optional(),
});

export const loginOtpBody = z.object({ challengeToken: z.string().min(1), code: otpCode });
export const forgotPasswordBody = z.object({ email });
export const resetPasswordBody = z.object({ email, code: otpCode, password: passwordSchema });
export const setupPasswordBody = z.object({ token: z.string().min(20), password: passwordSchema });
export const twoFactorBody = z.object({ enabled: z.boolean() });

export const googleLoginBody = z.object({
  credential: z.string().min(20).max(5000),
  libraryId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable()
    .optional(),
});
