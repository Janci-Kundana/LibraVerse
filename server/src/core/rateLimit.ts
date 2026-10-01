import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

// Brute-force and abuse protection (OWASP A07). Disabled in tests.
const skip = () => env.NODE_ENV === 'test';
const message = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
};

/**
 * What a sign-in attempt targets: the email, or the OTP challenge / setup token.
 * Hashed, so codes and tokens are never held in the limiter's memory.
 */
function authSubject(body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const value = [b.email, b.challengeToken, b.token].find((v) => typeof v === 'string');
  if (typeof value !== 'string') return '';
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/**
 * Behind the Vercel proxy, many visitors share one Vercel address, so a per-IP
 * key alone lets one person's typos lock everyone out. Key on IP + target.
 */
export function authLimitKey(req: Request): string {
  return `${ipKeyGenerator(req.ip ?? '')}|${authSubject(req.body)}`;
}

/** Sign-in, OTP, password reset: 20 per 15 minutes per address and account. */
const authTargetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: authLimitKey,
  message,
});

/** Backstop against trying many accounts from one address: 300 per 15 minutes. */
const authAddressLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  legacyHeaders: false,
  skip,
  message,
});

export const authLimiter = [authAddressLimiter, authTargetLimiter];

/** Public forms (library registration, joining, donations): 10 per hour per IP. */
export const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message,
});

/** AI assistant: 30 questions per hour per member (it costs money per call). */
export const assistantLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req: Request) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? ''),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'You have asked a lot of questions this hour. Try again later.',
    },
  },
});
