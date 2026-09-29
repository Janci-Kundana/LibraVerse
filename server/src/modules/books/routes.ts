import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import {
  copiesBody,
  createBookBody,
  importBody,
  updateBookBody,
  updateCopyBody,
} from './validation';

/** Catalog management for staff (FR-14). */
export const bookRoutes = Router();
bookRoutes.use(authenticate, requireRole('librarian'));
bookRoutes.get('/', c.list);
bookRoutes.get('/isbn/:isbn', c.lookupIsbn);
bookRoutes.get('/stickers.pdf', c.stickers);
bookRoutes.post('/import', validateBody(importBody), c.importCsv);
bookRoutes.post('/', validateBody(createBookBody), c.create);
bookRoutes.get('/:id', c.get);
bookRoutes.put('/:id', validateBody(updateBookBody), c.update);
bookRoutes.delete('/:id', c.remove);
bookRoutes.post('/:id/copies', validateBody(copiesBody), c.addCopies);

export const copyRoutes = Router();
copyRoutes.use(authenticate, requireRole('librarian'));
copyRoutes.put('/:id', validateBody(updateCopyBody), c.updateCopy);
copyRoutes.delete('/:id', c.deleteCopy);
copyRoutes.get('/:id/qr.png', c.copyQr);
