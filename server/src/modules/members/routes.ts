import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as plans from '../membershipPlans/controller';
import * as c from './controller';
import { requireVerifiedMember } from './middleware';
import { joinBody, rejectBody, resubmitIdBody } from './validation';

/** Public sign-up (FR-02). */
export const joinRoutes = Router();
joinRoutes.post('/join', validateBody(joinBody), c.join);

/** The signed-in member's own area. */
export const memberRoutes = Router();
memberRoutes.use(authenticate, requireRole('member'));
memberRoutes.get('/profile', c.myProfile);
memberRoutes.post('/id-proof', validateBody(resubmitIdBody), c.resubmitId);
// Everything below needs an approved ID.
memberRoutes.use(requireVerifiedMember);
memberRoutes.get('/plans', plans.listActive);

/** Librarian ID-verification queue (FR-13). */
export const verificationRoutes = Router();
verificationRoutes.use(authenticate, requireRole('librarian'));
verificationRoutes.get('/', c.listVerifications);
verificationRoutes.get('/:profileId/id-proof', c.idProof);
verificationRoutes.post('/:profileId/approve', c.decide('approve'));
verificationRoutes.post('/:profileId/reject', validateBody(rejectBody), c.decide('reject'));
