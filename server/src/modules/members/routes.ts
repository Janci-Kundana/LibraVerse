import { Router } from 'express';
import { publicFormLimiter } from '../../core/rateLimit';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as plans from '../membershipPlans/controller';
import * as c from './controller';
import { requireVerifiedMember } from './middleware';
import { joinBody, photoBody, rejectBody, resubmitIdBody } from './validation';

/** Public sign-up (FR-02). */
export const joinRoutes = Router();
joinRoutes.post('/join', publicFormLimiter, validateBody(joinBody), c.join);

/** The signed-in member's own area. */
export const memberRoutes = Router();
memberRoutes.use(authenticate, requireRole('member'));
memberRoutes.get('/profile', c.myProfile);
memberRoutes.post('/id-proof', validateBody(resubmitIdBody), c.resubmitId);
memberRoutes.post('/photo', validateBody(photoBody), c.setPhoto);
memberRoutes.get('/photo', c.myPhoto);
memberRoutes.get('/photo/pending', c.myPendingPhoto);
// Everything below needs an approved ID.
memberRoutes.use(requireVerifiedMember);
memberRoutes.get('/plans', plans.listActive);
memberRoutes.get('/standing', c.myStanding);
memberRoutes.get('/celebration', c.celebration);
memberRoutes.post('/celebration/:paymentId/seen', c.celebrationSeen);

/** Staff: members with standing, and their photos. Mounted at /api/members. */
export const staffMemberRoutes = Router();
staffMemberRoutes.get('/', authenticate, requireRole('librarian'), c.listMembers);
staffMemberRoutes.get('/:profileId/photo', authenticate, requireRole('librarian'), c.memberPhoto);

/** Librarian ID-verification queue (FR-13). */
export const verificationRoutes = Router();
verificationRoutes.use(authenticate, requireRole('librarian'));
verificationRoutes.get('/', c.listVerifications);
// New card photos from approved members wait here for staff approval.
verificationRoutes.get('/photo-changes', c.listPhotoChanges);
verificationRoutes.get('/photo-changes/:profileId/photo', c.requestedPhoto);
verificationRoutes.post('/photo-changes/:profileId/approve', c.decidePhoto('approve'));
verificationRoutes.post(
  '/photo-changes/:profileId/reject',
  validateBody(rejectBody),
  c.decidePhoto('reject'),
);
verificationRoutes.get('/:profileId/id-proof', c.idProof);
verificationRoutes.post('/:profileId/approve', c.decide('approve'));
verificationRoutes.post('/:profileId/reject', validateBody(rejectBody), c.decide('reject'));
