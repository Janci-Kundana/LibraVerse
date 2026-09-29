import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as coupons from './service';

export const list: RequestHandler = async (_req, res) => {
  res.json(await coupons.listCoupons());
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await coupons.createCoupon(libraryOf(req), req.body, actorOf(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await coupons.updateCoupon(String(req.params.id), req.body));
};

export const remove: RequestHandler = async (req, res) => {
  await coupons.deleteCoupon(String(req.params.id));
  res.status(204).end();
};
