import { Router } from 'express';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import * as c from './controller';
import { reviewBody } from './validation';

/** Member discovery (FR-19): mounted at /api/member/catalog. */
export const catalogRoutes = Router();
catalogRoutes.use(authenticate, requireRole('member'), requireVerifiedMember);
catalogRoutes.get('/books', c.search);
catalogRoutes.get('/facets', c.facets);
catalogRoutes.get('/books/:id', c.detail);
catalogRoutes.put('/books/:id/review', validateBody(reviewBody), c.review);
catalogRoutes.delete('/books/:id/review', c.deleteReview);
catalogRoutes.get('/wishlist', c.wishlist);
catalogRoutes.put('/wishlist/:id', c.setWishlisted(true));
catalogRoutes.delete('/wishlist/:id', c.setWishlisted(false));
