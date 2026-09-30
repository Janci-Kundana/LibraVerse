import QRCode from 'qrcode';
import { Types } from 'mongoose';
import type { MemberCardDto } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { notFound } from '../../core/ids';
import { outstandingDues, standing } from '../dues/service';
import { LibraryModel } from '../libraries/model';
import { MemberProfileModel } from '../members/model';
import { UserModel } from '../users/model';
import { cardToken } from './token';

/** The member's virtual card (FR-21). Tenant context of a verified member. */
export async function getCard(libraryId: string, userId: string): Promise<MemberCardDto> {
  const memberId = new Types.ObjectId(userId);
  const [user, profile, library] = await Promise.all([
    UserModel.findById(memberId).select('name').lean(),
    MemberProfileModel.findOne({ userId: memberId }).lean(),
    LibraryModel.findById(libraryId).select('name logoUrl cardColours').lean(),
  ]);
  if (!user || !profile || !library) throw notFound('Card');
  if (!profile.membershipNo) {
    throw new AppError(409, 'NO_CARD', 'Your card is issued once your ID is verified');
  }

  const now = new Date();
  const { cardStatus } = standing(profile, await outstandingDues(memberId), now);
  // The QR holds only ids + an HMAC; details are fetched fresh on every scan.
  const qrToken = cardToken(userId, libraryId);

  return {
    name: user.name,
    libraryName: library.name,
    libraryInitial: library.name.trim()[0]?.toUpperCase() ?? 'L',
    logoUrl: library.logoUrl ?? null,
    cardColours: library.cardColours,
    membershipNo: profile.membershipNo,
    memberSince: (profile.verifiedAt ?? profile.createdAt).toISOString(),
    validTill: profile.validTill ? profile.validTill.toISOString() : null,
    tier: profile.cardTier,
    status: cardStatus === 'active' ? 'active' : cardStatus === 'blocked' ? 'blocked' : 'expired',
    hasPhoto: profile.photoKey != null,
    qrToken,
    qrDataUrl: await QRCode.toDataURL(qrToken, {
      margin: 1,
      width: 360,
      errorCorrectionLevel: 'M',
    }),
    revealed: profile.cardRevealedAt != null,
  };
}

/** The first-activation reveal animation plays once; this records that it has. */
export async function markRevealed(userId: string) {
  await MemberProfileModel.updateOne(
    { userId: new Types.ObjectId(userId), cardRevealedAt: null },
    { $set: { cardRevealedAt: new Date() } },
  );
}
