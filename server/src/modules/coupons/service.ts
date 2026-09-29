import type { Types } from 'mongoose';
import type { CouponDto, Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { recordAudit } from '../audit/service';
import { CouponModel, type Coupon } from './model';
import type { CouponInput } from './validation';

// FR-10. Tenant context. Coupons are applied at checkout in Phase 5.

type Actor = { id: string; role: Role };

const toDto = (c: Coupon & { _id: Types.ObjectId }): CouponDto => ({
  id: String(c._id),
  code: c.code,
  discountPercent: c.discountPercent,
  validTill: c.validTill.toISOString(),
  active: c.active,
});

const codeTaken = () =>
  new AppError(409, 'CODE_TAKEN', 'That coupon code already exists', { field: 'code' });

export async function listCoupons() {
  return (await CouponModel.find().sort({ createdAt: -1 }).lean()).map(toDto);
}

export async function createCoupon(libraryId: string, input: CouponInput, actor: Actor) {
  try {
    const coupon = await CouponModel.create(input);
    await recordAudit({
      libraryId,
      actor,
      action: 'coupon.created',
      target: { type: 'coupon', id: coupon._id },
      details: { code: coupon.code, discountPercent: coupon.discountPercent },
    });
    return toDto(coupon);
  } catch (err) {
    if (isDuplicateKey(err)) throw codeTaken();
    throw err;
  }
}

export async function updateCoupon(id: string, input: CouponInput) {
  try {
    const coupon = await CouponModel.findOneAndUpdate({ _id: parseId(id, 'Coupon') }, input, {
      new: true,
      runValidators: true,
    }).lean();
    if (!coupon) throw notFound('Coupon');
    return toDto(coupon);
  } catch (err) {
    if (isDuplicateKey(err)) throw codeTaken();
    throw err;
  }
}

export async function deleteCoupon(id: string) {
  const res = await CouponModel.deleteOne({ _id: parseId(id, 'Coupon') });
  if (res.deletedCount === 0) throw notFound('Coupon');
}

/** A usable coupon by code, or null. Used by checkout. */
export async function findUsableCoupon(code: string) {
  return CouponModel.findOne({
    code: code.trim().toUpperCase(),
    active: true,
    validTill: { $gte: new Date() },
  }).lean();
}
