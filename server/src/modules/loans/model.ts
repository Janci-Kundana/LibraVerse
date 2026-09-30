import { Schema, model, type InferSchemaType } from 'mongoose';
import { LOAN_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// A copy issued to a member. Money in paise. finePerDay is copied from the
// member's plan at issue time, so later plan edits don't change old fines.
const loanSchema = new Schema(
  {
    libraryId: libraryIdPath,
    copyId: { type: Schema.Types.ObjectId, ref: 'BookCopy', required: true },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, required: true },
    dueAt: { type: Date, required: true },
    returnedAt: { type: Date, default: null },
    returnedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: LOAN_STATUSES, default: 'active' },
    renewals: { type: Number, default: 0 },
    finePerDay: { type: Number, required: true, min: 0 },
    fineAmount: { type: Number, default: 0 },
    damageCharge: { type: Number, default: 0 },
    chargeNote: { type: String, default: null },
    // Dues can be settled in parts (a deposit deduction may cover only some).
    duesPaidAmount: { type: Number, default: 0, min: 0 },
    duesPaidAt: { type: Date, default: null }, // set once fully paid
    duesPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reminders: {
      dueSoonAt: { type: Date, default: null },
      overdueAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

loanSchema.plugin(tenantPlugin);
// At most one active loan per copy, even if two librarians scan at once.
loanSchema.index(
  { libraryId: 1, copyId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
loanSchema.index({ libraryId: 1, memberId: 1, status: 1 });
loanSchema.index({ libraryId: 1, status: 1, dueAt: 1 });

export type Loan = InferSchemaType<typeof loanSchema>;
export const LoanModel = model('Loan', loanSchema, 'loans');
