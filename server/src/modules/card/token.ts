import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../core/errors';

// Card QR payload: LV1.<memberUserId>.<libraryId>.<HMAC-SHA256(memberId:libraryId)>
// Verified server-side on every scan, so a forged or edited QR is rejected.

const PREFIX = 'LV1';

function sign(memberId: string, libraryId: string): string {
  return createHmac('sha256', env.CARD_QR_SECRET)
    .update(`${memberId}:${libraryId}`)
    .digest('base64url');
}

export function cardToken(memberId: string, libraryId: string): string {
  return `${PREFIX}.${memberId}.${libraryId}.${sign(memberId, libraryId)}`;
}

const invalid = () =>
  new AppError(400, 'INVALID_CARD', 'This is not a valid LibraVerse membership card');

/** Returns the member id if the token is genuine and belongs to `libraryId`. */
export function verifyCardToken(token: string, libraryId: string): string {
  const parts = token.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw invalid();
  const [, memberId, cardLibraryId, sig] = parts as [string, string, string, string];
  if (!/^[a-f\d]{24}$/i.test(memberId) || !/^[a-f\d]{24}$/i.test(cardLibraryId)) throw invalid();

  const expected = Buffer.from(sign(memberId, cardLibraryId));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid();

  if (cardLibraryId !== libraryId) {
    throw new AppError(400, 'OTHER_LIBRARY_CARD', 'This card belongs to a different library');
  }
  return memberId;
}
