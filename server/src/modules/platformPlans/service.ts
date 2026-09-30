import type { PlatformPlanDto } from '@libraverse/shared';
import { PlatformPlanModel } from './model';

// Initial plan limits; the Super Admin edits them in Phase 7 (FR-06).
const DEFAULT_PLANS = [
  { code: 'free', name: 'Free', monthlyPrice: 0, memberLimit: 100, branchLimit: 1 },
  { code: 'pro', name: 'Pro', monthlyPrice: 99_900, memberLimit: null, branchLimit: 10 },
] as const;

/** Inserts the default plans if missing; never overwrites edited ones. */
export async function ensureDefaultPlans() {
  await PlatformPlanModel.bulkWrite(
    DEFAULT_PLANS.map((plan) => ({
      updateOne: { filter: { code: plan.code }, update: { $setOnInsert: plan }, upsert: true },
    })),
  );
}

export async function listActivePlans(
  opts: { includeInactive?: boolean } = {},
): Promise<PlatformPlanDto[]> {
  const plans = await PlatformPlanModel.find(opts.includeInactive ? {} : { active: true })
    .sort({ monthlyPrice: 1 })
    .lean();
  return plans.map((p) => ({
    id: String(p._id),
    code: p.code,
    name: p.name,
    monthlyPrice: p.monthlyPrice,
    memberLimit: p.memberLimit ?? null,
    branchLimit: p.branchLimit ?? null,
    active: p.active,
  }));
}
