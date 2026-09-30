import { z } from 'zod';
import type { PaymentSettingsDto, Role } from '@libraverse/shared';
import { env } from '../../config/env';
import { encryptSecret } from '../../core/crypto';
import { notFound } from '../../core/ids';
import { recordAudit } from '../audit/service';
import { LibraryModel } from '../libraries/model';

// FR-08: each library connects its own Razorpay account (test mode only).

export const paymentSettingsBody = z.object({
  keyId: z
    .string()
    .trim()
    .regex(/^rzp_test_[A-Za-z0-9]{8,}$/, 'must be a Razorpay test-mode key id (rzp_test_…)'),
  /** omit to keep the stored secret */
  keySecret: z.string().trim().min(8).max(100).optional(),
  webhookSecret: z.string().trim().min(8).max(100).optional(),
});
export type PaymentSettingsInput = z.infer<typeof paymentSettingsBody>;

export function webhookUrl(libraryId: string) {
  const base = env.PUBLIC_API_URL ?? env.CLIENT_URL;
  return `${base.replace(/\/$/, '')}/api/webhooks/razorpay/${libraryId}`;
}

export async function getPaymentSettings(libraryId: string): Promise<PaymentSettingsDto> {
  const lib = await LibraryModel.findById(libraryId)
    .select('razorpayKeyId +razorpayKeySecret +razorpayWebhookSecret')
    .lean();
  if (!lib) throw notFound('Library');
  return {
    keyId: lib.razorpayKeyId ?? null,
    keySecretSet: lib.razorpayKeySecret != null,
    webhookSecretSet: lib.razorpayWebhookSecret != null,
    webhookUrl: webhookUrl(libraryId),
  };
}

export async function updatePaymentSettings(
  libraryId: string,
  input: PaymentSettingsInput,
  actor: { id: string; role: Role },
) {
  const set: Record<string, unknown> = { razorpayKeyId: input.keyId };
  if (input.keySecret) set.razorpayKeySecret = encryptSecret(input.keySecret);
  if (input.webhookSecret) set.razorpayWebhookSecret = encryptSecret(input.webhookSecret);
  await LibraryModel.updateOne({ _id: libraryId }, { $set: set });
  await recordAudit({
    libraryId,
    actor,
    action: 'library.paymentKeysUpdated',
    target: { type: 'library', id: libraryId },
    // Which fields changed, never their values.
    details: {
      keyId: input.keyId,
      keySecretChanged: Boolean(input.keySecret),
      webhookSecretChanged: Boolean(input.webhookSecret),
    },
  });
  return getPaymentSettings(libraryId);
}
