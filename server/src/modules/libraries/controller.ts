import type { RequestHandler } from 'express';
import * as libraries from './service';
import { listLibrariesQuery, type LibraryAction } from './validation';

export const register: RequestHandler = async (req, res) => {
  res.status(201).json(await libraries.registerLibrary(req.body));
};

export const list: RequestHandler = async (req, res) => {
  res.json(await libraries.listLibraries(listLibrariesQuery.parse(req.query)));
};

export function changeStatus(action: LibraryAction): RequestHandler {
  return async (req, res) => {
    const { userId, role } = req.auth!;
    res.json(
      await libraries.changeLibraryStatus(
        String(req.params.id),
        action,
        { id: userId, role },
        req.body.reason,
      ),
    );
  };
}
