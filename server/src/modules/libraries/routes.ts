import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { LIBRARY_ACTIONS, libraryActionBody, registerLibraryBody } from './validation';

/** Public: library self-registration (FR-01). */
export const libraryRoutes = Router();
libraryRoutes.post('/register', validateBody(registerLibraryBody), c.register);

/** Super Admin: approve, reject, suspend, reactivate (FR-05). */
export const adminLibraryRoutes = Router();
adminLibraryRoutes.use(authenticate, requireRole('superAdmin'));
adminLibraryRoutes.get('/', c.list);
for (const action of LIBRARY_ACTIONS) {
  adminLibraryRoutes.post(
    `/:id/${action}`,
    validateBody(libraryActionBody),
    c.changeStatus(action),
  );
}
