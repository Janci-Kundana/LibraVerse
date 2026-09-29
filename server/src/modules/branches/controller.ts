import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as branches from './service';

export const list: RequestHandler = async (_req, res) => {
  res.json(await branches.listBranches());
};

export const get: RequestHandler = async (req, res) => {
  res.json(await branches.getBranch(String(req.params.id)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await branches.createBranch(libraryOf(req), req.body, actorOf(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await branches.updateBranch(String(req.params.id), req.body));
};

export const remove: RequestHandler = async (req, res) => {
  await branches.deleteBranch(libraryOf(req), String(req.params.id), actorOf(req));
  res.status(204).end();
};
