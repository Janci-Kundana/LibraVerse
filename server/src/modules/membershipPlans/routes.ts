import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { membershipPlanBody } from './validation';

export const membershipPlanRoutes = Router();
membershipPlanRoutes.use(authenticate, requireRole('librarian'));
membershipPlanRoutes.get('/', c.list);
membershipPlanRoutes.post(
  '/',
  requireRole('libraryAdmin'),
  validateBody(membershipPlanBody),
  c.create,
);
membershipPlanRoutes.put(
  '/:id',
  requireRole('libraryAdmin'),
  validateBody(membershipPlanBody),
  c.update,
);
