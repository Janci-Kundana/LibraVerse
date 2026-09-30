import { Router } from 'express';
import { authenticate, libraryOf } from '../auth/middleware';
import * as notifications from './service';

export const notificationRoutes = Router();
notificationRoutes.use(authenticate);
notificationRoutes.get('/', async (req, res) => {
  libraryOf(req); // library accounts only
  res.json(await notifications.mine(req.auth!.userId));
});
notificationRoutes.post('/read', async (req, res) => {
  libraryOf(req);
  await notifications.markRead(
    req.auth!.userId,
    typeof req.body?.id === 'string' ? req.body.id : undefined,
  );
  res.status(204).end();
});
