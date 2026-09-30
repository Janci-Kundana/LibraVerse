import express, { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import { handlePlatformWebhook } from '../billing/service';
import * as c from './controller';
import { paymentSettingsBody } from './settings';
import { chargeBody, counterBody, refundBody } from './validation';

/** Mounted before the JSON parser: the signature covers the exact raw bytes. */
export const webhookRoutes = Router();
const raw = express.raw({ type: '*/*', limit: '1mb' });
// Platform billing first: "platform" would otherwise match :libraryId.
webhookRoutes.post('/razorpay/platform', raw, async (req, res) => {
  const result = await handlePlatformWebhook(
    req.body as Buffer,
    req.header('x-razorpay-signature'),
    req.header('x-razorpay-event-id'),
  );
  res.json({ ok: true, result });
});
webhookRoutes.post('/razorpay/:libraryId', raw, c.webhook);

export const paymentSettingsRoutes = Router();
paymentSettingsRoutes.use(authenticate, requireRole('libraryAdmin'));
paymentSettingsRoutes.get('/', c.getSettings);
paymentSettingsRoutes.put('/', validateBody(paymentSettingsBody), c.updateSettings);

export const staffPaymentRoutes = Router();
staffPaymentRoutes.use(authenticate, requireRole('librarian'));
staffPaymentRoutes.get('/', c.list);
staffPaymentRoutes.post('/counter', validateBody(counterBody), c.counter);
staffPaymentRoutes.get('/:id', c.get);
staffPaymentRoutes.get('/:id/receipt.pdf', c.receipt);
staffPaymentRoutes.post(
  '/:id/refund',
  requireRole('libraryAdmin'),
  validateBody(refundBody),
  c.refund,
);

/** Member payments, mounted at /api/member/payments. TC-08: verified members only. */
export const memberPaymentRoutes = Router();
memberPaymentRoutes.use(authenticate, requireRole('member'), requireVerifiedMember);
memberPaymentRoutes.get('/', c.myList);
memberPaymentRoutes.post('/', validateBody(chargeBody), c.checkout);
memberPaymentRoutes.get('/:id', c.myPayment);
memberPaymentRoutes.post('/:id/opened', c.opened);
memberPaymentRoutes.get('/:id/receipt.pdf', c.myReceipt);

export const publicPayRoutes = Router();
publicPayRoutes.get('/:token', c.publicPay);
publicPayRoutes.post('/:token/opened', c.publicPayOpened);
