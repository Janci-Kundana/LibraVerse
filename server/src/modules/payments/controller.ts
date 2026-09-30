import type { Request, RequestHandler } from 'express';
import { actorOf, libraryOf } from '../auth/middleware';
import * as payments from './service';
import * as settings from './settings';
import { listQuery } from './validation';

const me = (req: Request) => req.auth!.userId;

// Library admin: Razorpay keys
export const getSettings: RequestHandler = async (req, res) => {
  res.json(await settings.getPaymentSettings(libraryOf(req)));
};
export const updateSettings: RequestHandler = async (req, res) => {
  res.json(await settings.updatePaymentSettings(libraryOf(req), req.body, actorOf(req)));
};

// Staff
export const list: RequestHandler = async (req, res) => {
  res.json(await payments.listPayments(listQuery.parse(req.query)));
};
export const get: RequestHandler = async (req, res) => {
  res.json(await payments.getPayment(String(req.params.id)));
};
export const counter: RequestHandler = async (req, res) => {
  res.status(201).json(await payments.counterPayment(libraryOf(req), req.body, actorOf(req)));
};
export const refund: RequestHandler = async (req, res) => {
  res.json(
    await payments.refundPayment(libraryOf(req), String(req.params.id), req.body, actorOf(req)),
  );
};
export const receipt: RequestHandler = async (req, res) => {
  const r = await payments.paymentReceipt(libraryOf(req), String(req.params.id));
  res
    .type('application/pdf')
    .set('Content-Disposition', `inline; filename="${r.filename}"`)
    .send(r.pdf);
};

// Member
export const checkout: RequestHandler = async (req, res) => {
  res.status(201).json(await payments.startCheckout(libraryOf(req), me(req), req.body));
};
export const opened: RequestHandler = async (req, res) => {
  await payments.markOpened(me(req), String(req.params.id));
  res.status(204).end();
};
export const verify: RequestHandler = async (req, res) => {
  res.json(await payments.verifyMemberPayment(libraryOf(req), me(req), String(req.params.id)));
};
export const cancel: RequestHandler = async (req, res) => {
  res.json(await payments.cancelMemberPayment(libraryOf(req), me(req), String(req.params.id)));
};
export const staffVerify: RequestHandler = async (req, res) => {
  res.json(await payments.verifyStaffPayment(libraryOf(req), String(req.params.id)));
};
export const publicPayVerify: RequestHandler = async (req, res) => {
  res.json(await payments.publicPayVerify(String(req.params.token)));
};
export const myList: RequestHandler = async (req, res) => {
  res.json(await payments.listPayments({ memberId: me(req) }));
};
export const myPayment: RequestHandler = async (req, res) => {
  res.json(await payments.getPayment(String(req.params.id), me(req)));
};
export const myReceipt: RequestHandler = async (req, res) => {
  const r = await payments.paymentReceipt(libraryOf(req), String(req.params.id), me(req));
  res
    .type('application/pdf')
    .set('Content-Disposition', `inline; filename="${r.filename}"`)
    .send(r.pdf);
};

// Public pay link
export const publicPay: RequestHandler = async (req, res) => {
  res.json(await payments.publicPay(String(req.params.token)));
};
export const publicPayOpened: RequestHandler = async (req, res) => {
  await payments.publicPayOpened(String(req.params.token));
  res.status(204).end();
};

// Razorpay webhook: always answers quickly; a bad signature is a 400.
export const webhook: RequestHandler = async (req, res) => {
  const result = await payments.handleWebhook(
    String(req.params.libraryId),
    req.body as Buffer,
    req.header('x-razorpay-signature'),
    req.header('x-razorpay-event-id'),
  );
  res.json({ ok: true, result });
};
