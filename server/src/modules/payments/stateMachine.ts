import type { PaymentStatus } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import type { Model } from 'mongoose';
import { PaymentModel } from './model';

// Any collection with the payment status fields (library payments, platform billing).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PaymentLikeModel = Model<any>;

// The only code that changes a payment's status (rule 2).
//   created → pending → success | failed | expired
//   created → success | failed | expired   (e.g. cash, or a webhook before "opened")
// success, failed and expired are terminal.

const ALLOWED_FROM: Record<PaymentStatus, PaymentStatus[]> = {
  created: [],
  pending: ['created'],
  success: ['created', 'pending'],
  failed: ['created', 'pending'],
  expired: ['created', 'pending'],
};

export const TERMINAL: PaymentStatus[] = ['success', 'failed', 'expired'];

export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, 'INVALID_TRANSITION', `Payment is ${from}; it cannot become ${to}`, { from, to });
  }
}

/**
 * Atomically moves a payment to `to` if its current status allows it. Repeating
 * a transition that already happened is a no-op (`changed: false`), which makes
 * webhook retries safe. Anything else throws InvalidTransitionError.
 * Runs in the payment's tenant context.
 */
export async function transitionPayment(
  paymentId: unknown,
  to: PaymentStatus,
  opts: { source: string; note?: string; set?: Record<string, unknown> } = { source: 'system' },
  // Library payments by default; platform billing passes its own collection.
  model: PaymentLikeModel = PaymentModel as unknown as PaymentLikeModel,
) {
  const now = new Date();
  const updated = await model.findOneAndUpdate(
    { _id: paymentId, status: { $in: ALLOWED_FROM[to] } },
    {
      $set: { status: to, ...opts.set },
      $push: { history: { status: to, at: now, source: opts.source, note: opts.note ?? null } },
    },
    { new: true },
  );
  if (updated) return { payment: updated, changed: true };

  const current = await model.findById(paymentId);
  if (!current) throw new AppError(404, 'NOT_FOUND', 'Payment not found');
  if (current.status === to) return { payment: current, changed: false };
  throw new InvalidTransitionError(current.status, to);
}
