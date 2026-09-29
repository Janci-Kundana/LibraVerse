import { Schema, model, type InferSchemaType } from 'mongoose';
import { CARD_TIERS } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Plans a library sells to its members (FR-10). Money in paise.
const membershipPlanSchema = new Schema(
  {
    libraryId: libraryIdPath,
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    bookLimit: { type: Number, required: true, min: 0 },
    finePerDay: { type: Number, required: true, min: 0 },
    tier: { type: String, enum: CARD_TIERS, default: 'member' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

membershipPlanSchema.plugin(tenantPlugin);
membershipPlanSchema.index({ libraryId: 1, name: 1 }, { unique: true });

export type MembershipPlan = InferSchemaType<typeof membershipPlanSchema>;
export const MembershipPlanModel = model('MembershipPlan', membershipPlanSchema, 'membershipPlans');
