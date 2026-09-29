import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as staff from './service';

export const list: RequestHandler = async (_req, res) => {
  res.json(await staff.listStaff());
};

export const add: RequestHandler = async (req, res) => {
  res.status(201).json(await staff.addLibrarian(libraryOf(req), req.body, actorOf(req)));
};

export const remove: RequestHandler = async (req, res) => {
  await staff.removeLibrarian(libraryOf(req), String(req.params.id), actorOf(req));
  res.status(204).end();
};
