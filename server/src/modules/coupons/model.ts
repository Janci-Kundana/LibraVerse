import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

const couponSchema = new Schema(
  {
    libraryId: libraryIdPath,
    code: { type: String, required: true, uppercase: true, trim: true },
    discountPercent: { type: Number, required: true, min: 1, max: 100 },
    validTill: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.plugin(tenantPlugin);
couponSchema.index({ libraryId: 1, code: 1 }, { unique: true });

export type Coupon = InferSchemaType<typeof couponSchema>;
export const CouponModel = model('Coupon', couponSchema, 'coupons');
