import { Router } from 'express';
import { env } from '../../config/env';
import { validateBody } from '../../core/validate';
import { authenticate } from '../auth/middleware';
import { pushEnabled, subscribe, subscribeBody, unsubscribe } from './service';

export const pushRoutes = Router();

pushRoutes.get('/public-key', (_req, res) => {
  res.json({ enabled: pushEnabled(), publicKey: env.VAPID_PUBLIC_KEY ?? null });
});

// Library users only: subscriptions are tenant data.
pushRoutes.post('/subscribe', authenticate, validateBody(subscribeBody), async (req, res) => {
  if (!req.auth?.libraryId) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Library accounts only' } });
    return;
  }
  await subscribe(req.auth.userId, req.body);
  res.status(204).end();
});

pushRoutes.delete('/subscribe', authenticate, async (req, res) => {
  if (req.auth?.libraryId && typeof req.body?.endpoint === 'string') {
    await unsubscribe(req.auth.userId, req.body.endpoint);
  }
  res.status(204).end();
});
