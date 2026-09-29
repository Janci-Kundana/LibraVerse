import { Router } from 'express';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';

export const branchRoutes = Router();
branchRoutes.use(authenticate, requireRole('librarian'));
branchRoutes.get('/', c.list);
branchRoutes.get('/:id', c.get);
