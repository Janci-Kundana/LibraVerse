import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../../core/validate';
import { actorOf, authenticate, libraryOf, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import * as refunds from './refunds';

const requestBody = z.object({ reason: z.string().trim().max(300).optional() });
const approveBody = z.object({
  method: z.enum(['cash', 'razorpay']),
  note: z.string().trim().max(300).optional(),
});
const rejectBody = z.object({ reason: z.string().trim().min(3).max(300) });

/** Member: request or cancel a deposit refund. Mounted at /api/member/deposit-refund. */
export const memberRefundRoutes = Router();
memberRefundRoutes.use(authenticate, requireRole('member'), requireVerifiedMember);
memberRefundRoutes.get('/', async (req, res) => {
  res.json(await refunds.myRefund(req.auth!.userId));
});
memberRefundRoutes.post('/', validateBody(requestBody), async (req, res) => {
  res
    .status(201)
    .json(await refunds.requestRefund(libraryOf(req), req.auth!.userId, req.body.reason));
});
memberRefundRoutes.delete('/', async (req, res) => {
  res.json(await refunds.cancelRequest(req.auth!.userId));
});

/** Staff: the refund queue; approve (cash/Razorpay), reject, or refund at the counter. */
export const staffRefundRoutes = Router();
staffRefundRoutes.use(authenticate, requireRole('librarian'));
staffRefundRoutes.get('/', async (_req, res) => {
  res.json(await refunds.listRequests());
});
staffRefundRoutes.post('/:profileId/approve', validateBody(approveBody), async (req, res) => {
  res.json(
    await refunds.approveRefund(
      libraryOf(req),
      String(req.params.profileId),
      req.body.method,
      actorOf(req),
      req.body.note,
    ),
  );
});
staffRefundRoutes.post('/:profileId/reject', validateBody(rejectBody), async (req, res) => {
  await refunds.rejectRefund(
    libraryOf(req),
    String(req.params.profileId),
    req.body.reason,
    actorOf(req),
  );
  res.status(204).end();
});
staffRefundRoutes.post('/:profileId/refund', validateBody(approveBody), async (req, res) => {
  res.json(
    await refunds.staffRefund(
      libraryOf(req),
      String(req.params.profileId),
      req.body.method,
      actorOf(req),
      req.body.note,
    ),
  );
});
