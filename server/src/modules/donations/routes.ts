import { Router } from 'express';
import { publicFormLimiter } from '../../core/rateLimit';
import { validateBody } from '../../core/validate';
import { verifyAccess, ACCESS_COOKIE } from '../auth/tokens';
import { actorOf, authenticate, libraryOf, requireRole } from '../auth/middleware';
import { LibraryModel } from '../libraries/model';
import * as donations from './service';

/** Public offer form (a signed-in member of that library is credited). */
export const publicDonationRoutes = Router();
publicDonationRoutes.post(
  '/:slug/donations',
  publicFormLimiter,
  validateBody(donations.offerBody),
  async (req, res) => {
    let memberId: string | null = null;
    try {
      const token: unknown = req.cookies?.[ACCESS_COOKIE];
      if (typeof token === 'string') {
        const claims = verifyAccess(token);
        const lib = await LibraryModel.findOne({ slug: req.params.slug }).select('_id').lean();
        if (claims.role === 'member' && lib && claims.lib === String(lib._id))
          memberId = claims.sub;
      }
    } catch {
      // Anonymous visitors are fine.
    }
    res.status(201).json(await donations.offer(String(req.params.slug), req.body, memberId));
  },
);

export const donationRoutes = Router();
donationRoutes.use(authenticate, requireRole('librarian'));
donationRoutes.get('/', async (req, res) => {
  res.json(
    await donations.list(typeof req.query.status === 'string' ? req.query.status : undefined),
  );
});
donationRoutes.post('/:id/accept', validateBody(donations.decideBody), async (req, res) => {
  res.json(
    await donations.decide(
      libraryOf(req),
      String(req.params.id),
      true,
      req.body.note,
      actorOf(req),
    ),
  );
});
donationRoutes.post('/:id/decline', validateBody(donations.decideBody), async (req, res) => {
  res.json(
    await donations.decide(
      libraryOf(req),
      String(req.params.id),
      false,
      req.body.note,
      actorOf(req),
    ),
  );
});
donationRoutes.post('/:id/catalogue', validateBody(donations.catalogueBody), async (req, res) => {
  res
    .status(201)
    .json(await donations.catalogue(libraryOf(req), String(req.params.id), req.body, actorOf(req)));
});
