import type { Types } from 'mongoose';
import type { MembershipPlanDto, Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { recordAudit } from '../audit/service';
import { MembershipPlanModel, type MembershipPlan } from './model';
import type { MembershipPlanInput } from './validation';

// FR-10. Tenant context. Plans are never deleted (members and payments point
// at them); deactivating hides them from members.

type Actor = { id: string; role: Role };

export const toPlanDto = (p: MembershipPlan & { _id: Types.ObjectId }): MembershipPlanDto => ({
  id: String(p._id),
  name: p.name,
  price: p.price,
  durationDays: p.durationDays,
  bookLimit: p.bookLimit,
  finePerDay: p.finePerDay,
  tier: p.tier,
  active: p.active,
});

const nameTaken = () =>
  new AppError(409, 'NAME_TAKEN', 'A plan with that name already exists', { field: 'name' });

export async function listPlans(opts: { activeOnly?: boolean } = {}) {
  const plans = await MembershipPlanModel.find(opts.activeOnly ? { active: true } : {})
    .sort({ price: 1 })
    .lean();
  return plans.map(toPlanDto);
}

export async function createPlan(libraryId: string, input: MembershipPlanInput, actor: Actor) {
  try {
    const plan = await MembershipPlanModel.create(input);
    await recordAudit({
      libraryId,
      actor,
      action: 'membershipPlan.created',
      target: { type: 'membershipPlan', id: plan._id },
      details: { ...input },
    });
    return toPlanDto(plan);
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
}

export async function updatePlan(
  libraryId: string,
  id: string,
  input: MembershipPlanInput,
  actor: Actor,
) {
  const _id = parseId(id, 'Plan');
  try {
    const plan = await MembershipPlanModel.findOneAndUpdate({ _id }, input, {
      new: true,
      runValidators: true,
    }).lean();
    if (!plan) throw notFound('Plan');
    await recordAudit({
      libraryId,
      actor,
      action: 'membershipPlan.updated',
      target: { type: 'membershipPlan', id: _id },
      details: { ...input },
    });
    return toPlanDto(plan);
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
}
