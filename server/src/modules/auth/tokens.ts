import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role } from '@libraverse/shared';
import { env } from '../../config/env';
import { AppError } from '../../core/errors';

export const ACCESS_COOKIE = 'lv_access';
export const REFRESH_COOKIE = 'lv_refresh';
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHALLENGE_TTL_SECONDS = 10 * 60;

export interface AccessClaims {
  sub: string;
  role: Role;
  lib: string | null;
}

interface RefreshClaims {
  sub: string;
  sid: string;
  jti: string;
}

const unauthenticated = (message = 'Sign in required') =>
  new AppError(401, 'UNAUTHENTICATED', message);

function verify<T>(token: string, secret: string, audience: string): T {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'], audience }) as T;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Session expired');
    }
    throw unauthenticated();
  }
}

export function signAccess(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    audience: 'access',
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

export const verifyAccess = (token: string) =>
  verify<AccessClaims>(token, env.JWT_ACCESS_SECRET, 'access');

export function signRefresh(claims: RefreshClaims): string {
  return jwt.sign(claims, env.JWT_REFRESH_SECRET, {
    algorithm: 'HS256',
    audience: 'refresh',
    expiresIn: REFRESH_TTL_SECONDS,
  });
}

export const verifyRefresh = (token: string) =>
  verify<RefreshClaims>(token, env.JWT_REFRESH_SECRET, 'refresh');

/** Short-lived token proving the password step of a 2FA login passed. */
export function signChallenge(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    audience: 'login-otp',
    expiresIn: CHALLENGE_TTL_SECONDS,
  });
}

export const verifyChallenge = (token: string) =>
  verify<{ sub: string }>(token, env.JWT_ACCESS_SECRET, 'login-otp');

export function signSocketToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    audience: 'socket',
    expiresIn: 5 * 60,
  });
}

export const verifySocketToken = (token: string) =>
  verify<AccessClaims>(token, env.JWT_ACCESS_SECRET, 'socket');

export const newJti = () => randomBytes(24).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Random opaque token for emailed links; only its hash is stored. */
export const newLinkToken = () => randomBytes(32).toString('base64url');

export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Keyed so a leaked database alone cannot brute-force the 6-digit codes.
export const hashOtp = (code: string) =>
  createHmac('sha256', env.JWT_REFRESH_SECRET).update(code).digest('hex');

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function cookieBase(): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production' };
}

export function setAuthCookies(res: Response, tokens: { access: string; refresh: string }) {
  res.cookie(ACCESS_COOKIE, tokens.access, {
    ...cookieBase(),
    path: '/',
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refresh, {
    ...cookieBase(),
    path: '/api/auth',
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/auth' });
}
