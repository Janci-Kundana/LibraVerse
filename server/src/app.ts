import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import type { HealthResponse } from '@libraverse/shared';
import { env } from './config/env';
import { dbState } from './core/db';
import { errorHandler, notFound } from './core/errors';
import { authRoutes } from './modules/auth/routes';
import { branchRoutes } from './modules/branches/routes';
import { adminLibraryRoutes, libraryRoutes } from './modules/libraries/routes';
import { platformPlanRoutes } from './modules/platformPlans/routes';
import { pushRoutes } from './modules/push/routes';
import { registerPushChannel } from './modules/push/service';
import { adminPlanRoutes, subscriptionRoutes } from './modules/billing/routes';
import { assistantRoutes } from './modules/assistant/routes';
import { bookRoutes, copyRoutes } from './modules/books/routes';
import { auditRoutes, platformReportRoutes, reportRoutes } from './modules/reports/routes';
import { donationRoutes, publicDonationRoutes } from './modules/donations/routes';
import { eventRoutes, memberEventRoutes } from './modules/events/routes';
import { notificationRoutes } from './modules/notifications/routes';
import { registerInAppChannel } from './modules/notifications/service';
import { catalogRoutes } from './modules/catalog/routes';
import { circulationRoutes, memberCirculationRoutes } from './modules/circulation/routes';
import { couponRoutes } from './modules/coupons/routes';
import { fileRoutes } from './modules/files/routes';
import { librarySettingsRoutes, publicLibraryRoutes } from './modules/librarySettings/routes';
import {
  joinRoutes,
  memberRoutes,
  staffMemberRoutes,
  verificationRoutes,
} from './modules/members/routes';
import { membershipPlanRoutes } from './modules/membershipPlans/routes';
import {
  memberPaymentRoutes,
  paymentSettingsRoutes,
  publicPayRoutes,
  staffPaymentRoutes,
  webhookRoutes,
} from './modules/payments/routes';
import { staffRoutes } from './modules/staff/routes';

// Routes that accept files (as data URLs) or CSV get a larger body limit.
const UPLOAD_PATHS = [
  '/api/members/join',
  '/api/member/id-proof',
  '/api/member/photo',
  '/api/library/settings',
];
const isUpload = (path: string) => UPLOAD_PATHS.includes(path) || path.startsWith('/api/books');

export function createApp() {
  const app = express();
  registerPushChannel();
  registerInAppChannel();

  app.disable('x-powered-by');
  // Behind Render's proxy: trust one hop so client IPs (rate limits) and
  // secure cookies are correct.
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(cookieParser());
  // Razorpay webhooks verify an HMAC over the raw body, so they are mounted
  // before any JSON parsing.
  app.use('/api/webhooks', webhookRoutes);
  const smallJson = express.json({ limit: '1mb' });
  const uploadJson = express.json({ limit: '8mb' });
  app.use((req, res, next) => (isUpload(req.path) ? uploadJson : smallJson)(req, res, next));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      db: dbState(),
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/platform-plans', platformPlanRoutes);
  app.use('/api/libraries', libraryRoutes);
  app.use('/api/admin/libraries', adminLibraryRoutes);
  app.use('/api/branches', branchRoutes);
  app.use('/api/public/libraries', publicLibraryRoutes);
  app.use('/api/library/settings', librarySettingsRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/membership-plans', membershipPlanRoutes);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/members', joinRoutes);
  app.use('/api/members', staffMemberRoutes);
  app.use('/api/books', bookRoutes);
  app.use('/api/copies', copyRoutes);
  app.use('/api/member/catalog', catalogRoutes);
  app.use('/api/circulation', circulationRoutes);
  app.use('/api/library/payment-settings', paymentSettingsRoutes);
  app.use('/api/payments', staffPaymentRoutes);
  app.use('/api/member/payments', memberPaymentRoutes);
  app.use('/api/pay', publicPayRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/library/subscription', subscriptionRoutes);
  app.use('/api/admin/plans', adminPlanRoutes);
  app.use('/api/public/libraries', publicDonationRoutes);
  app.use('/api/donations', donationRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/member/events', memberEventRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/admin/reports', platformReportRoutes);
  app.use('/api/member/assistant', assistantRoutes);
  app.use('/api/member', memberCirculationRoutes);
  app.use('/api/member', memberRoutes);
  app.use('/api/verifications', verificationRoutes);
  app.use('/api/files', fileRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
