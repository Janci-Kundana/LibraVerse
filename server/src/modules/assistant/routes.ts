import { Router } from 'express';
import { assistantLimiter } from '../../core/rateLimit';
import { validateBody } from '../../core/validate';
import { authenticate, libraryOf, requireRole } from '../auth/middleware';
import { requireVerifiedMember } from '../members/middleware';
import { assistantEnabled, chat, chatBody } from './service';

export const assistantRoutes = Router();
assistantRoutes.use(authenticate, requireRole('member'), requireVerifiedMember);
assistantRoutes.get('/status', (_req, res) => {
  res.json({ enabled: assistantEnabled() });
});
assistantRoutes.post('/', assistantLimiter, validateBody(chatBody), async (req, res) => {
  res.json(await chat(libraryOf(req), req.auth!.userId, req.body.messages));
});
