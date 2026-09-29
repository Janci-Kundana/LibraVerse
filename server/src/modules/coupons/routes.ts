import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import * as c from './controller';
import { couponBody } from './validation';

export const couponRoutes = Router();
couponRoutes.use(authenticate, requireRole('libraryAdmin'));
couponRoutes.get('/', c.list);
couponRoutes.post('/', validateBody(couponBody), c.create);
couponRoutes.put('/:id', validateBody(couponBody), c.update);
couponRoutes.delete('/:id', c.remove);
