import { Schema, model, type InferSchemaType } from 'mongoose';
import { PAYMENT_STATUSES } from '@libraverse/shared';

// Platform-level: what a library pays the platform (Pro plan). Owned by the
// platform, not the tenant, so it is keyed by billedLibraryId rather than the
// tenant libraryId and read only by the Super Admin, webhooks, cron, or a
// library admin for their own library. Status changes go through
// transitionPayment() like library payments.
const platformPaymentSchema = new Schema(
  {
    billedLibraryId: { type: Schema.Types.ObjectId, ref: 'Library', required: true, index: true },
    platformPlanId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
    purpose: { type: String, enum: ['registration', 'upgrade'], required: true },
    amount: { type: Number, required: true, min: 1 }, // paise
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    expiresAt: { type: Date, required: true },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    refund: {
      type: new Schema(
        {
          amount: Number,
          reason: String,
          razorpayRefundId: String,
          refundedAt: Date,
        },
        { _id: false },
      ),
      default: null,
    },
    history: {
      type: [
        new Schema({ status: String, at: Date, source: String, note: String }, { _id: false }),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

platformPaymentSchema.index(
  { razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } },
);
platformPaymentSchema.index({ status: 1, expiresAt: 1 });

export type PlatformPayment = InferSchemaType<typeof platformPaymentSchema>;
export const PlatformPaymentModel = model(
  'PlatformPayment',
  platformPaymentSchema,
  'platformPayments',
);
