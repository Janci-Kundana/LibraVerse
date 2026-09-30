import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

// Brute-force and abuse protection (OWASP A07). Disabled in tests.
const skip = () => env.NODE_ENV === 'test';
const message = {
  error: { code: 'RATE_LIMITED', message: 'Too many attempts. Wait a few minutes and try again.' },
};

/** Sign-in, OTP, password reset: 20 per 15 minutes per IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message,
});

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
