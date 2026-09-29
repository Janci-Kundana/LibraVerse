import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as settings from './service';

export const get: RequestHandler = async (req, res) => {
  res.json(await settings.getSettings(libraryOf(req)));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await settings.updateSettings(libraryOf(req), req.body, actorOf(req)));
};

export const listPublic: RequestHandler = async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
  res.json(await settings.listPublicLibraries(q));
};

export const getPublic: RequestHandler = async (req, res) => {
  res.json(await settings.getPublicLibrary(String(req.params.slug)));
};
