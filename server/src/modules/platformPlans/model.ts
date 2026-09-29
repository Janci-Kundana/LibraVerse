import { Schema, model, type InferSchemaType } from 'mongoose';
import { PLATFORM_PLAN_CODES } from '@libraverse/shared';

// Platform-level (not tenant-owned): the Free and Pro plans sold to libraries.
const platformPlanSchema = new Schema(
  {
    code: { type: String, enum: PLATFORM_PLAN_CODES, required: true, unique: true },
    name: { type: String, required: true },
    monthlyPrice: { type: Number, required: true, min: 0 }, // paise
    memberLimit: { type: Number, default: null }, // null = unlimited
    branchLimit: { type: Number, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export type PlatformPlan = InferSchemaType<typeof platformPlanSchema>;
export const PlatformPlanModel = model('PlatformPlan', platformPlanSchema, 'platformPlans');
