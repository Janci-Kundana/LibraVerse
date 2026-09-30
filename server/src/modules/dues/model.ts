import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Ledger of every change to a member's security deposit. balanceAfter is the
// deposit after this entry; it is never negative.
const depositTransactionSchema = new Schema(
  {
    libraryId: libraryIdPath,
    memberId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['collected', 'deduction'], required: true },
    amount: { type: Number, required: true, min: 0 }, // paise
    balanceAfter: { type: Number, required: true, min: 0 },
    dueBefore: { type: Number, default: null },
    dueAfter: { type: Number, default: null },
    reason: { type: String, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    loanIds: { type: [Schema.Types.ObjectId], default: [] },
    // Makes each deduction or collection happen at most once.
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true },
);

depositTransactionSchema.plugin(tenantPlugin);
depositTransactionSchema.index({ libraryId: 1, idempotencyKey: 1 }, { unique: true });
depositTransactionSchema.index({ libraryId: 1, memberId: 1, createdAt: -1 });

export type DepositTransaction = InferSchemaType<typeof depositTransactionSchema>;
export const DepositTransactionModel = model(
  'DepositTransaction',
  depositTransactionSchema,
  'depositTransactions',
);
