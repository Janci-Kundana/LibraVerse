import { Schema, model, type InferSchemaType } from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_PURPOSES, PAYMENT_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Every payment attempt. Status changes only through transitionPayment() in
// stateMachine.ts; success comes only from a verified webhook (or recorded cash).
const paymentSchema = new Schema(
  {
    libraryId: libraryIdPath,
    memberId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { type: Number, required: true, min: 1 }, // paise, what is charged
    discount: { type: Number, default: 0 },
    // Part of `amount` that tops the member's security deposit up (membership only).
    depositAmount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String, default: null },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', default: null },
    loanIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'created' },
    expiresAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    payToken: { type: String, default: null }, // counter QR link
    receiptNo: { type: String, default: null },
    collectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    failureReason: { type: String, default: null },
    refund: {
      type: new Schema(
        {
          amount: { type: Number, required: true },
          reason: { type: String, required: true },
          razorpayRefundId: { type: String, default: null },
          refundedAt: { type: Date, required: true },
          refundedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    // A capture that arrived after the payment expired (auto-refunded).
    lateCapture: {
      type: new Schema(
        {
          razorpayPaymentId: { type: String, required: true },
          razorpayRefundId: { type: String, default: null },
          at: { type: Date, required: true },
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

paymentSchema.plugin(tenantPlugin);
paymentSchema.index(
  { libraryId: 1, razorpayOrderId: 1 },
  { unique: true, partialFilterExpression: { razorpayOrderId: { $type: 'string' } } },
);
paymentSchema.index(
  { payToken: 1 },
  { unique: true, partialFilterExpression: { payToken: { $type: 'string' } } },
);
paymentSchema.index(
  { libraryId: 1, receiptNo: 1 },
  { unique: true, partialFilterExpression: { receiptNo: { $type: 'string' } } },
);
paymentSchema.index({ libraryId: 1, status: 1, expiresAt: 1 });
paymentSchema.index({ libraryId: 1, memberId: 1, createdAt: -1 });

export type Payment = InferSchemaType<typeof paymentSchema>;
export const PaymentModel = model('Payment', paymentSchema, 'payments');
