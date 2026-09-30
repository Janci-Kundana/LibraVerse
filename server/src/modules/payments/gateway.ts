import Razorpay from 'razorpay';
import { AppError } from '../../core/errors';
import { decryptSecret, type EncryptedValue } from '../../core/crypto';
import { LibraryModel } from '../libraries/model';

// Thin adapter over the Razorpay SDK so the payment logic can be tested with a
// fake gateway. Credentials are decrypted here, at the point of use, and never
// leave this module.

export interface Gateway {
  keyId: string;
  createOrder(input: {
    amount: number;
    receipt: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
  refund(
    razorpayPaymentId: string,
    amount: number,
    notes: Record<string, string>,
  ): Promise<{ id: string }>;
  /** Server-to-server: the payment attempts on an order, straight from Razorpay. */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
}

export interface GatewayPayment {
  id: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  amount: number;
  /** when Razorpay created the payment attempt */
  createdAt: Date | null;
  errorDescription: string | null;
}

export interface Credentials {
  keyId: string;
  keySecret: string;
}

function razorpayGateway({ keyId, keySecret }: Credentials): Gateway {
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return {
    keyId,
    async createOrder({ amount, receipt, notes }) {
      const order = await client.orders.create({ amount, currency: 'INR', receipt, notes });
      return { id: order.id };
    },
    async refund(paymentId, amount, notes) {
      const refund = await client.payments.refund(paymentId, { amount, notes });
      return { id: refund.id };
    },
    async fetchOrderPayments(orderId) {
      const res = await client.orders.fetchPayments(orderId);
      return (res.items ?? []).map((p) => ({
        id: p.id,
        status: String(p.status),
        amount: Number(p.amount),
        createdAt: p.created_at ? new Date(Number(p.created_at) * 1000) : null,
        errorDescription: (p.error_description as string | null | undefined) ?? null,
      }));
    },
  };
}

let factory: (creds: Credentials) => Gateway = razorpayGateway;

/** Tests swap in a fake gateway; pass nothing to restore Razorpay. */
export function setGatewayFactory(f?: (creds: Credentials) => Gateway) {
  factory = f ?? razorpayGateway;
}

/** A gateway for explicit credentials (the platform's own account). */
export const gatewayFromCredentials = (creds: Credentials) => factory(creds);

export async function libraryGateway(libraryId: string): Promise<Gateway> {
  const lib = await LibraryModel.findById(libraryId)
    .select('+razorpayKeySecret razorpayKeyId')
    .lean();
  const secret = lib?.razorpayKeySecret as EncryptedValue | null | undefined;
  if (!lib?.razorpayKeyId || !secret) {
    throw new AppError(
      409,
      'PAYMENTS_NOT_CONFIGURED',
      'This library has not set up online payments yet',
    );
  }
  return factory({ keyId: lib.razorpayKeyId, keySecret: decryptSecret(secret) });
}

/** Maps any gateway failure to a clean 502 without leaking provider details. */
export async function callGateway<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    console.error(
      'Razorpay call failed:',
      (err as { error?: { description?: string } })?.error?.description ?? err,
    );
    throw new AppError(502, 'GATEWAY_ERROR', 'The payment provider did not respond. Try again.');
  }
}
