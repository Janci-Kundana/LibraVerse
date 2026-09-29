import type { RequestHandler } from 'express';
import * as catalog from './service';
import { searchQuery } from './validation';

const me = (req: Parameters<RequestHandler>[0]) => req.auth!.userId;

export const search: RequestHandler = async (req, res) => {
  res.json(await catalog.search(me(req), searchQuery.parse(req.query)));
};

export const facets: RequestHandler = async (_req, res) => {
  res.json(await catalog.facets());
};

export const detail: RequestHandler = async (req, res) => {
  res.json(await catalog.detail(me(req), String(req.params.id)));
};

export const review: RequestHandler = async (req, res) => {
  res.json(await catalog.upsertReview(me(req), String(req.params.id), req.body));
};

export const deleteReview: RequestHandler = async (req, res) => {
  await catalog.deleteReview(me(req), String(req.params.id));
  res.status(204).end();
};

export const wishlist: RequestHandler = async (req, res) => {
  res.json(await catalog.wishlist(me(req)));
};

export function setWishlisted(on: boolean): RequestHandler {
  return async (req, res) => {
    await catalog.setWishlisted(me(req), String(req.params.id), on);
    res.status(204).end();
  };
}
