import type { RequestHandler } from 'express';
import type { LoginResponse } from '@libraverse/shared';
import { env } from '../../config/env';
import * as auth from './service';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './tokens';

export const login: RequestHandler = async (req, res) => {
  const result = await auth.login(req.body);
  if (result.status === 'twoFactorRequired') {
    res.json(result satisfies LoginResponse);
    return;
  }
  setAuthCookies(res, result.tokens);
  res.json({ status: 'ok', user: result.user } satisfies LoginResponse);
};

export const loginOtp: RequestHandler = async (req, res) => {
  const { user, tokens } = await auth.verifyLoginOtp(req.body.challengeToken, req.body.code);
  setAuthCookies(res, tokens);
  res.json({ status: 'ok', user } satisfies LoginResponse);
};

export const refresh: RequestHandler = async (req, res) => {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  try {
    const { user, tokens } = await auth.refresh(typeof token === 'string' ? token : '');
    setAuthCookies(res, tokens);
    res.json({ user });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
};

export const logout: RequestHandler = async (req, res) => {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  await auth.logout(typeof token === 'string' ? token : undefined);
  clearAuthCookies(res);
  res.status(204).end();
};

export const me: RequestHandler = async (req, res) => {
  res.json({ user: await auth.me(req.auth!.userId) });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  await auth.forgotPassword(req.body.email);
  // Same answer whether or not the email exists.
  res.json({ message: 'If that email has an account, a reset code is on its way.' });
};

export const resetPassword: RequestHandler = async (req, res) => {
  await auth.resetPassword(req.body);
  res.json({ message: 'Password updated. Sign in with your new password.' });
};

export const setupPassword: RequestHandler = async (req, res) => {
  res.json(await auth.setupPassword(req.body));
};

export const setTwoFactor: RequestHandler = async (req, res) => {
  res.json({ user: await auth.setTwoFactor(req.auth!.userId, req.body.enabled) });
};

export const googleLogin: RequestHandler = async (req, res) => {
  const result = await auth.loginWithGoogle(req.body.credential, req.body.libraryId);
  if (result.status === 'twoFactorRequired') {
    res.json(result satisfies LoginResponse);
    return;
  }
  setAuthCookies(res, result.tokens);
  res.json({ status: 'ok', user: result.user } satisfies LoginResponse);
};

export const config: RequestHandler = (_req, res) => {
  res.json({ googleClientId: auth.googleEnabled() ? env.GOOGLE_CLIENT_ID : null });
};
