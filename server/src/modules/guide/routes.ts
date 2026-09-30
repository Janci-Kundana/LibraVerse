import { Router } from 'express';
import { assistantLimiter } from '../../core/rateLimit';
import { validateBody } from '../../core/validate';
import { authenticate, requireRole } from '../auth/middleware';
import { assistantEnabled } from '../assistant/service';
import { askGuide } from './service';
import { guideBody } from './validation';

/** In-app guide for every signed-in role (read-only help). */
export const guideRoutes = Router();
guideRoutes.use(authenticate, requireRole('superAdmin', 'libraryAdmin', 'librarian', 'member'));
guideRoutes.get('/status', (_req, res) => {
  res.json({ enabled: assistantEnabled() });
});
guideRoutes.post('/', assistantLimiter, validateBody(guideBody), async (req, res) => {
  res.json(await askGuide(req.auth!, req.body));
});
