import type { RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as card from '../card/service';
import * as reservations from '../reservations/service';
import * as circulation from './service';
import { loansQuery, reservationsQuery } from './validation';

export const scan: RequestHandler = async (req, res) => {
  res.json(await circulation.scanMember(libraryOf(req), req.body.memberToken));
};

export const issue: RequestHandler = async (req, res) => {
  res.status(201).json(await circulation.issue(libraryOf(req), req.body, actorOf(req)));
};

export const copy: RequestHandler = async (req, res) => {
  res.json(await circulation.copyStatus(String(req.params.code)));
};

export const returnCopy: RequestHandler = async (req, res) => {
  res.json(await circulation.returnCopy(libraryOf(req), req.body, actorOf(req)));
};

export const loans: RequestHandler = async (req, res) => {
  res.json(await circulation.listLoans(loansQuery.parse(req.query)));
};

export const renew: RequestHandler = async (req, res) => {
  res.json(await circulation.renew(libraryOf(req), String(req.params.id), actorOf(req)));
};

export const lost: RequestHandler = async (req, res) => {
  res.json(await circulation.markLost(libraryOf(req), String(req.params.id), actorOf(req)));
};

export const staffReservations: RequestHandler = async (req, res) => {
  res.json(await reservations.listForStaff(reservationsQuery.parse(req.query).status));
};

// Member side

export const myLoans: RequestHandler = async (req, res) => {
  const [loans, holds] = await Promise.all([
    circulation.memberLoans(req.auth!.userId),
    reservations.listForMember(req.auth!.userId),
  ]);
  res.json({ ...loans, reservations: holds });
};

export const reserve: RequestHandler = async (req, res) => {
  res.status(201).json(await reservations.reserve(req.auth!.userId, req.body.bookId));
};

export const cancelReservation: RequestHandler = async (req, res) => {
  await reservations.cancel(libraryOf(req), req.auth!.userId, String(req.params.id));
  res.status(204).end();
};

export const myCard: RequestHandler = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await card.getCard(libraryOf(req), req.auth!.userId));
};

export const cardRevealed: RequestHandler = async (req, res) => {
  await card.markRevealed(req.auth!.userId);
  res.status(204).end();
};
