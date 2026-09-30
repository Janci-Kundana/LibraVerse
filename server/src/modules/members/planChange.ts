import type { Types } from 'mongoose';
import { AppError } from '../../core/errors';
import { MembershipPlanModel } from '../membershipPlans/model';
import { MemberProfileModel } from './model';

// Plan changes take effect when the current period ends (decided with the
// user). Buying a different plan while one is running schedules it: the card
// keeps the current plan and tier, validTill grows by the new plan's days,
// and nextPlan takes over at the old end date. One change at a time.
// Tenant context of the member's library.

const DAY_MS = 86_400_000;

interface PlanLike {
  _id: Types.ObjectId;
  name?: string;
  durationDays: number;
  tier: 'member' | 'gold' | 'premium' | 'elite';
}

interface ProfileState {
  planId?: Types.ObjectId | null;
  validTill?: Date | null;
  nextPlan?: { planId: Types.ObjectId; startsAt: Date } | null;
}

const same = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);
const running = (p: ProfileState, now: Date) => Boolean(p.validTill && p.validTill > now);
const day = (d: Date) => d.toLocaleDateString('en-IN', { dateStyle: 'medium' });

/**
 * Checkout guard: with a change already scheduled, only more time on that
 * scheduled plan can be bought.
 */
export async function assertPlanPurchasable(
  profile: ProfileState | null,
  plan: PlanLike,
  now = new Date(),
) {
  if (!profile?.nextPlan || !running(profile, now)) return;
  if (same(profile.nextPlan.planId, plan._id)) return;
  const next = await MembershipPlanModel.findById(profile.nextPlan.planId).select('name').lean();
  throw new AppError(
    409,
    'PLAN_CHANGE_PENDING',
    `${next?.name ?? 'Your new plan'} already starts on ${day(profile.nextPlan.startsAt)}. ` +
      `You can buy more of it now, or choose another plan after it starts.`,
  );
}

/**
 * Applies a confirmed membership payment to the profile document (not saved).
 * Returns when the bought plan starts: now, or the end of the current period.
 */
export function applyMembership(
  profile: ProfileState & { set: (v: Record<string, unknown>) => unknown },
  plan: PlanLike,
  paymentId: Types.ObjectId,
  now = new Date(),
): { startsAt: Date } {
  const days = plan.durationDays * DAY_MS;
  if (!running(profile, now)) {
    profile.set({
      planId: plan._id,
      cardTier: plan.tier,
      currentPeriodStart: now,
      validTill: new Date(now.getTime() + days),
      nextPlan: null,
    });
    return { startsAt: now };
  }
  const end = profile.validTill!;
  const extended = new Date(end.getTime() + days);
  if (profile.nextPlan) {
    // More time on the scheduled plan (checkout allows nothing else).
    profile.set({ validTill: extended });
    return { startsAt: profile.nextPlan.startsAt };
  }
  if (same(profile.planId, plan._id)) {
    // Renewing early extends from the current end date.
    profile.set({ validTill: extended, currentPeriodStart: end });
    return { startsAt: end };
  }
  profile.set({
    validTill: extended,
    nextPlan: { planId: plan._id, startsAt: end, paymentId },
  });
  return { startsAt: end };
}

/**
 * Switches every scheduled plan whose start has come (one member's, or the
 * whole library's). Run by the job and before reads that depend on the plan.
 */
export async function applyDuePlanChanges(now = new Date(), userId?: Types.ObjectId | string) {
  const due = await MemberProfileModel.find({
    'nextPlan.startsAt': { $lte: now },
    ...(userId ? { userId } : {}),
  })
    .select('nextPlan cardTier')
    .lean();
  for (const p of due) {
    const next = p.nextPlan!;
    const plan = await MembershipPlanModel.findById(next.planId).select('tier').lean();
    await MemberProfileModel.updateOne(
      { _id: p._id, 'nextPlan.startsAt': next.startsAt },
      {
        $set: {
          planId: next.planId,
          cardTier: plan?.tier ?? p.cardTier,
          currentPeriodStart: next.startsAt,
          nextPlan: null,
        },
      },
    );
  }
  return due.length;
}
