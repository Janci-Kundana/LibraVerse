import type { MemberScanDto } from '@libraverse/shared';
import { LibraryModel } from '../libraries/model';
import type { MemberProfile } from '../members/model';

// Pure circulation rules shared by loans, reservations, payments and jobs.

export const DAY_MS = 24 * 60 * 60 * 1000;

export const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Whole days late, counting any part of a day; 0 when on time. */
export function overdueDays(dueAt: Date, at: Date): number {
  return Math.max(0, Math.ceil((at.getTime() - dueAt.getTime()) / DAY_MS));
}

export async function circulationSettings(libraryId: string) {
  const lib = await LibraryModel.findById(libraryId).select('name circulation').lean();
  return {
    libraryName: lib?.name ?? 'your library',
    loanDays: lib?.circulation?.loanDays ?? 14,
    maxRenewals: lib?.circulation?.maxRenewals ?? 2,
    holdDays: lib?.circulation?.holdDays ?? 3,
    lostBookCharge: lib?.circulation?.lostBookCharge ?? 50_000,
  };
}

export function membershipStatus(
  p: Pick<MemberProfile, 'verificationStatus' | 'planId' | 'validTill'>,
  now = new Date(),
): MemberScanDto['membershipStatus'] {
  if (p.verificationStatus !== 'approved') return 'unverified';
  if (!p.planId || !p.validTill) return 'none';
  return p.validTill < now ? 'expired' : 'active';
}
