import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { branchBody } from './validation';

export const branchRoutes = Router();
branchRoutes.use(authenticate, requireRole('librarian'));
branchRoutes.get('/', c.list);
branchRoutes.get('/:id', c.get);
branchRoutes.post('/', requireRole('libraryAdmin'), validateBody(branchBody), c.create);
branchRoutes.put('/:id', requireRole('libraryAdmin'), validateBody(branchBody), c.update);
branchRoutes.delete('/:id', requireRole('libraryAdmin'), c.remove);
