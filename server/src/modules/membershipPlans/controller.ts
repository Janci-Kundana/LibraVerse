import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as plans from './service';

export const list: RequestHandler = async (_req, res) => {
  res.json(await plans.listPlans());
};

export const listActive: RequestHandler = async (_req, res) => {
  res.json(await plans.listPlans({ activeOnly: true }));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await plans.createPlan(libraryOf(req), req.body, actorOf(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await plans.updatePlan(libraryOf(req), String(req.params.id), req.body, actorOf(req)));
};
