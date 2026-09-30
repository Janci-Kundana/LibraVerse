import { Router } from 'express';
import { z } from 'zod';
import { runAsSystem } from '../../core/tenant';
import { parseId } from '../../core/ids';
import { validateBody } from '../../core/validate';
import { actorOf, authenticate, libraryOf, requireRole } from '../auth/middleware';
import { PlatformPlanModel } from '../platformPlans/model';
import { listActivePlans } from '../platformPlans/service';
import { AppError } from '../../core/errors';
import { LibraryModel } from '../libraries/model';
import * as billing from './service';

/** Library admin: own subscription (FR-12). */
export const subscriptionRoutes = Router();
subscriptionRoutes.use(authenticate, requireRole('libraryAdmin'));
subscriptionRoutes.get('/', async (req, res) => {
  res.json(await billing.getSubscription(libraryOf(req)));
});
subscriptionRoutes.post('/upgrade', async (req, res) => {
  const lib = await LibraryModel.findById(libraryOf(req)).select('status').lean();
  if (lib?.status !== 'active')
    throw new AppError(409, 'LIBRARY_NOT_ACTIVE', 'The library must be active');
  res.status(201).json(await billing.createPlatformPayment(libraryOf(req), 'upgrade'));
});
subscriptionRoutes.post('/downgrade', async (req, res) => {
  res.json(await billing.downgrade(libraryOf(req), actorOf(req)));
});

const planBody = z.object({
  name: z.string().trim().min(1).max(40),
  monthlyPrice: z.number().int().min(0).max(100_000_000),
  memberLimit: z.number().int().min(1).nullable(),
  branchLimit: z.number().int().min(1).nullable(),
  active: z.boolean(),
});

/** Super Admin: platform plans (FR-06). */
export const adminPlanRoutes = Router();
adminPlanRoutes.use(authenticate, requireRole('superAdmin'));
adminPlanRoutes.get('/', async (_req, res) => {
  res.json(await listActivePlans({ includeInactive: true }));
});
adminPlanRoutes.put('/:id', validateBody(planBody), async (req, res) => {
  const id = parseId(req.params.id, 'Plan');
  const plan = await runAsSystem('superAdmin:edit-plan', () =>
    PlatformPlanModel.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }),
  );
  if (!plan) throw new AppError(404, 'NOT_FOUND', 'Plan not found');
  res.json((await listActivePlans({ includeInactive: true })).find((p) => p.id === String(id)));
});
