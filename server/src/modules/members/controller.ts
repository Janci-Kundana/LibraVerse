import type { RequestHandler } from 'express';
import { AppError } from '../../core/errors';
import { actorOf, libraryOf } from '../auth/middleware';
import { setAuthCookies } from '../auth/tokens';
import * as members from './service';
import { verificationQuery } from './validation';

export const join: RequestHandler = async (req, res) => {
  const { user, tokens } = await members.joinLibrary(req.body);
  setAuthCookies(res, tokens);
  res.status(201).json({ status: 'ok', user });
};

export const myProfile: RequestHandler = async (req, res) => {
  res.json(await members.getMyProfile(req.auth!.userId));
};

export const resubmitId: RequestHandler = async (req, res) => {
  res.json(await members.resubmitIdProof(req.auth!.userId, req.body.idProof));
};

export const listVerifications: RequestHandler = async (req, res) => {
  res.json(await members.listVerifications(verificationQuery.parse(req.query).status));
};

export const idProof: RequestHandler = async (req, res) => {
  const file = await members.openIdProof(String(req.params.profileId));
  // Sensitive: never cached by the browser or a proxy.
  res.set('Cache-Control', 'no-store, private');
  if ('redirect' in file) {
    res.redirect(302, file.redirect);
    return;
  }
  res.type(file.mime).send(file.data);
};

export function decide(decision: 'approve' | 'reject'): RequestHandler {
  return async (req, res) => {
    if (decision === 'reject' && !req.body?.reason) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A reason is required');
    }
    res.json(
      await members.decideVerification(
        libraryOf(req),
        String(req.params.profileId),
        decision,
        actorOf(req),
        req.body?.reason,
      ),
    );
  };
}
