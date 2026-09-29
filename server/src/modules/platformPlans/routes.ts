import { Router } from 'express';
import { listActivePlans } from './service';

export const platformPlanRoutes = Router();

// Public: the registration page shows these.
platformPlanRoutes.get('/', async (_req, res) => {
  res.json(await listActivePlans());
});
