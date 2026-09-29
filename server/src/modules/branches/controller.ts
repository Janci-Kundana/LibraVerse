import type { RequestHandler } from 'express';
import * as branches from './service';

export const list: RequestHandler = async (_req, res) => {
  res.json(await branches.listBranches());
};

export const get: RequestHandler = async (req, res) => {
  res.json(await branches.getBranch(String(req.params.id)));
};
