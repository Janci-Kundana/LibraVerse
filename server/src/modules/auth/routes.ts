import { Router } from 'express';
import { authLimiter } from '../../core/rateLimit';
import { validateBody } from '../../core/validate';
import * as c from './controller';
import { authenticate } from './middleware';
import * as v from './validation';

export const authRoutes = Router();

authRoutes.post('/login', authLimiter, validateBody(v.loginBody), c.login);
authRoutes.post('/login/otp', authLimiter, validateBody(v.loginOtpBody), c.loginOtp);
authRoutes.post('/google', authLimiter, validateBody(v.googleLoginBody), c.googleLogin);
authRoutes.get('/socket-token', authenticate, c.socketToken);
authRoutes.get('/config', c.config);
authRoutes.post('/refresh', c.refresh);
authRoutes.post('/logout', c.logout);
authRoutes.get('/me', authenticate, c.me);
authRoutes.post(
  '/password/forgot',
  authLimiter,
  validateBody(v.forgotPasswordBody),
  c.forgotPassword,
);
authRoutes.post('/password/reset', authLimiter, validateBody(v.resetPasswordBody), c.resetPassword);
authRoutes.post('/password/setup', authLimiter, validateBody(v.setupPasswordBody), c.setupPassword);
authRoutes.put('/two-factor', authenticate, validateBody(v.twoFactorBody), c.setTwoFactor);
