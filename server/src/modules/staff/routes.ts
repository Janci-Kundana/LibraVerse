import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { addStaffBody } from './validation';

export const staffRoutes = Router();
staffRoutes.use(authenticate, requireRole('libraryAdmin'));
staffRoutes.get('/', c.list);
staffRoutes.post('/', validateBody(addStaffBody), c.add);
staffRoutes.delete('/:id', c.remove);
