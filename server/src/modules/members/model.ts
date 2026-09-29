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
    badges: { type: [String], default: [] },
    wishlist: { type: [Schema.Types.ObjectId], ref: 'Book', default: [] },
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

export type MemberProfile = InferSchemaType<typeof memberProfileSchema>;
export const MemberProfileModel = model('MemberProfile', memberProfileSchema, 'memberProfiles');
