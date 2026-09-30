import { Router } from 'express';
import { validateBody } from '../../core/validate';
import * as c from './controller';
import { authenticate } from './middleware';
import * as v from './validation';

export const authRoutes = Router();

authRoutes.post('/login', validateBody(v.loginBody), c.login);
authRoutes.post('/login/otp', validateBody(v.loginOtpBody), c.loginOtp);
authRoutes.post('/google', validateBody(v.googleLoginBody), c.googleLogin);
authRoutes.get('/config', c.config);
authRoutes.post('/refresh', c.refresh);
authRoutes.post('/logout', c.logout);
authRoutes.get('/me', authenticate, c.me);
authRoutes.post('/password/forgot', validateBody(v.forgotPasswordBody), c.forgotPassword);
authRoutes.post('/password/reset', validateBody(v.resetPasswordBody), c.resetPassword);
authRoutes.post('/password/setup', validateBody(v.setupPasswordBody), c.setupPassword);
authRoutes.put('/two-factor', authenticate, validateBody(v.twoFactorBody), c.setTwoFactor);
