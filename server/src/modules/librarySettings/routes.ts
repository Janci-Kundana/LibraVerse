import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { updateSettingsBody } from './validation';

/** The signed-in library's own settings and branding (FR-08). */
export const librarySettingsRoutes = Router();
librarySettingsRoutes.use(authenticate);
librarySettingsRoutes.get('/', requireRole('librarian'), c.get);
librarySettingsRoutes.put(
  '/',
  requireRole('libraryAdmin'),
  validateBody(updateSettingsBody),
  c.update,
);

/** Public directory of active libraries. */
export const publicLibraryRoutes = Router();
publicLibraryRoutes.get('/', c.listPublic);
publicLibraryRoutes.get('/:slug', c.getPublic);
