import { Schema, model, type InferSchemaType } from 'mongoose';
import { CARD_TIERS, VERIFICATION_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Member-only details (one per member user). Membership stays inactive until
// staff approve the ID proof.
const memberProfileSchema = new Schema(
  {
    libraryId: libraryIdPath,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    phone: { type: String, default: null },
    idProofKey: { type: String, required: true }, // private file; served to staff only
    verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: 'pending' },
    verificationNote: { type: String, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    idSubmittedAt: { type: Date, required: true, default: () => new Date() },
    termsAcceptedAt: { type: Date, required: true },
    membershipNo: { type: String, default: null },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', default: null },
    validTill: { type: Date, default: null },
    cardTier: { type: String, enum: CARD_TIERS, default: 'member' },
    cardRevealedAt: { type: Date, default: null },
    expiryReminderAt: { type: Date, default: null },
    walletBalance: { type: Number, default: 0 }, // paise
    photoKey: { type: String, default: null }, // private profile picture; shown on the card and to staff
    currentPeriodStart: { type: Date, default: null }, // start of the latest paid membership
    // Refundable security deposit (paise). Never negative: every write goes
    // through dues/service.ts, which guards the update with depositBalance >= amount.
    depositBalance: { type: Number, default: 0, min: 0 },
    depositCollectedAt: { type: Date, default: null },
    // Current unpaid-dues cycle (warnings → notice → deduction). Reset when dues reach 0.
    dues: {
      type: new Schema(
        {
          since: { type: Date, default: null },
          warningsSent: { type: Number, default: 0 },
          lastWarningAt: { type: Date, default: null },
          deductionScheduledFor: { type: Date, default: null },
          noticeSentAt: { type: Date, default: null },
          lastDeductionKey: { type: String, default: null },
          lastDeductionAt: { type: Date, default: null },
          lastResolution: { type: String, enum: ['payment', 'deduction', null], default: null },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
    // Deposit refund: the member asks, staff approve (cash or Razorpay), and the
    // membership closes. Only what is left after dues is refunded.
    depositRefund: {
      type: new Schema(
        {
          status: {
            type: String,
            enum: ['requested', 'completed', 'rejected', 'cancelled'],
            required: true,
          },
          requestedAt: { type: Date, required: true },
          requestedBy: { type: String, enum: ['member', 'staff'], required: true },
          reason: { type: String, default: null },
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          decidedAt: { type: Date, default: null },
          method: { type: String, enum: ['cash', 'razorpay', null], default: null },
          amount: { type: Number, default: null },
          duesSettled: { type: Number, default: null },
          note: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    membershipClosedAt: { type: Date, default: null },
    // A confirmed membership payment the member has not yet seen celebrated.
    celebratePaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    badges: { type: [String], default: [] },
    wishlist: { type: [Schema.Types.ObjectId], ref: 'Book', default: [] },
    // A different plan bought while one is running: it takes over when the
    // current period ends (validTill already includes its days).
    nextPlan: {
      type: new Schema(
        {
          planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
          startsAt: { type: Date, required: true },
          paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    // After approval the card photo changes only with staff approval.
    photoChange: {
      type: new Schema(
        {
          key: { type: String, required: true }, // private file, like photoKey
          status: { type: String, enum: ['pending', 'rejected'], required: true },
          requestedAt: { type: Date, required: true },
          note: { type: String, default: null },
          decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
          decidedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

memberProfileSchema.plugin(tenantPlugin);
memberProfileSchema.index({ libraryId: 1, userId: 1 }, { unique: true });
memberProfileSchema.index(
  { libraryId: 1, membershipNo: 1 },
  { unique: true, partialFilterExpression: { membershipNo: { $type: 'string' } } },
);
memberProfileSchema.index({ libraryId: 1, verificationStatus: 1, idSubmittedAt: 1 });
memberProfileSchema.index({ libraryId: 1, 'nextPlan.startsAt': 1 }, { sparse: true });
memberProfileSchema.index({ libraryId: 1, 'photoChange.status': 1 }, { sparse: true });

export type MemberProfile = InferSchemaType<typeof memberProfileSchema>;
export const MemberProfileModel = model('MemberProfile', memberProfileSchema, 'memberProfiles');
