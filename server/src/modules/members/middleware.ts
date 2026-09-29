import type { RequestHandler } from 'express';
import { AppError } from '../../core/errors';
import { MemberProfileModel } from './model';

/**
 * Member routes past this point need an approved ID proof (TC-08). Runs after
 * `authenticate`, in the member's tenant context.
 */
export const requireVerifiedMember: RequestHandler = async (req, _res, next) => {
  if (req.auth?.role !== 'member') throw new AppError(403, 'FORBIDDEN', 'Members only');
  const profile = await MemberProfileModel.findOne({ userId: req.auth.userId })
    .select('verificationStatus')
    .lean();
  if (profile?.verificationStatus !== 'approved') {
    throw new AppError(
      403,
      'VERIFICATION_PENDING',
      'Verification pending: staff must approve your ID proof first',
      {
        verificationStatus: profile?.verificationStatus ?? null,
      },
    );
  }
  next();
};
