import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import * as c from './controller';
import { issueBody, reserveBody, returnBody, scanBody } from './validation';

/** Counter operations (FR-15, 16, 18). */
export const circulationRoutes = Router();
circulationRoutes.use(authenticate, requireRole('librarian'));
circulationRoutes.post('/scan-member', validateBody(scanBody), c.scan);
circulationRoutes.post('/issue', validateBody(issueBody), c.issue);
circulationRoutes.get('/copies/:code', c.copy);
circulationRoutes.post('/return', validateBody(returnBody), c.returnCopy);
circulationRoutes.get('/loans', c.loans);
circulationRoutes.post('/loans/:id/renew', c.renew);
circulationRoutes.post('/loans/:id/lost', c.lost);
circulationRoutes.get('/reservations', c.staffReservations);

/**
 * Member side (FR-21, 22, 19), mounted at /api/member alongside the profile
 * routes, so the guards are per route rather than router-wide.
 */
export const memberCirculationRoutes = Router();
const verifiedMember = [authenticate, requireRole('member'), requireVerifiedMember];
memberCirculationRoutes.get('/card', ...verifiedMember, c.myCard);
memberCirculationRoutes.post('/card/revealed', ...verifiedMember, c.cardRevealed);
memberCirculationRoutes.get('/loans', ...verifiedMember, c.myLoans);
memberCirculationRoutes.post('/loans/:id/renew', ...verifiedMember, c.renew);
memberCirculationRoutes.post(
  '/reservations',
  ...verifiedMember,
  validateBody(reserveBody),
  c.reserve,
);
memberCirculationRoutes.delete('/reservations/:id', ...verifiedMember, c.cancelReservation);
