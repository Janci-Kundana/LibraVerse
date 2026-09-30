import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  MemberProfileDto,
  Role,
  VerificationItemDto,
  VerificationStatus,
} from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { sendMail } from '../../core/mailer';
import { decodeDataUrl, openFile, putFile } from '../../core/storage';
import { runWithTenant } from '../../core/tenant';
import { recordAudit } from '../audit/service';
import { hashPassword, startSession, toAuthUser } from '../auth/service';
import { currentLimits } from '../billing/service';
import { LibraryModel } from '../libraries/model';
import { MembershipPlanModel } from '../membershipPlans/model';
import { UserModel } from '../users/model';
import { MemberProfileModel, type MemberProfile } from './model';
import type { JoinInput } from './validation';

type Actor = { id: string; role: Role };

const ID_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ID_PROOF_MAX = 5 * 1024 * 1024;

function decodeIdProof(dataUrl: string) {
  return decodeDataUrl(dataUrl, { allowed: ID_PROOF_TYPES, maxBytes: ID_PROOF_MAX });
}

/**
 * FR-02: a visitor joins an active library with ID proof. The account can sign
 * in straight away but sees "Verification pending" until staff approve the ID.
 */
export async function joinLibrary(input: JoinInput) {
  const library = await LibraryModel.findOne({ slug: input.librarySlug, status: 'active' }).lean();
  if (!library) throw notFound('Library');
  const file = decodeIdProof(input.idProof);

  return runWithTenant(library._id, async () => {
    const limits = await currentLimits();
    if (
      limits.memberLimit != null &&
      (await UserModel.countDocuments({ role: 'member', status: { $ne: 'disabled' } })) >=
        limits.memberLimit
    ) {
      throw new AppError(
        403,
        'PLAN_LIMIT',
        'This library is not accepting new members right now (plan limit reached)',
      );
    }
    if (await UserModel.exists({ email: input.email })) {
      throw new AppError(
        409,
        'EMAIL_TAKEN',
        'This email already has an account at this library. Sign in instead.',
        {
          field: 'email',
        },
      );
    }
    const stored = await putFile(file, `id-proofs/${library._id}`, 'private');
    let user;
    try {
      user = await UserModel.create({
        name: input.name,
        email: input.email,
        role: 'member',
        status: 'active',
        passwordHash: await hashPassword(input.password),
      });
    } catch (err) {
      if (isDuplicateKey(err))
        throw new AppError(409, 'EMAIL_TAKEN', 'This email already has an account here');
      throw err;
    }
    await MemberProfileModel.create({
      userId: user._id,
      phone: input.phone ?? null,
      idProofKey: stored.key,
      termsAcceptedAt: new Date(),
    });
    return { user: await toAuthUser(user), tokens: await startSession(user) };
  });
}

async function profileFor(userId: string) {
  const profile = await MemberProfileModel.findOne({ userId: new Types.ObjectId(userId) });
  if (!profile) throw notFound('Member profile');
  return profile;
}

export async function toProfileDto(
  p: MemberProfile & { _id: Types.ObjectId },
): Promise<MemberProfileDto> {
  const plan = p.planId ? await MembershipPlanModel.findById(p.planId).select('name').lean() : null;
  return {
    id: String(p._id),
    verificationStatus: p.verificationStatus,
    verificationNote: p.verificationNote ?? null,
    membershipNo: p.membershipNo ?? null,
    planId: p.planId ? String(p.planId) : null,
    planName: plan?.name ?? null,
    validTill: p.validTill ? p.validTill.toISOString() : null,
    cardTier: p.cardTier,
    walletBalance: p.walletBalance,
    badges: p.badges,
  };
}

export async function getMyProfile(userId: string) {
  return toProfileDto(await profileFor(userId));
}

/** A rejected member uploads a new ID proof, which goes back into the queue. */
export async function resubmitIdProof(userId: string, dataUrl: string) {
  const profile = await profileFor(userId);
  if (profile.verificationStatus !== 'rejected') {
    throw new AppError(409, 'NOT_REJECTED', 'Your ID proof is already submitted');
  }
  const stored = await putFile(decodeIdProof(dataUrl), `id-proofs/${profile.libraryId}`, 'private');
  profile.set({
    idProofKey: stored.key,
    verificationStatus: 'pending',
    verificationNote: null,
    idSubmittedAt: new Date(),
  });
  await profile.save();
  return toProfileDto(profile);
}

export async function listVerifications(
  status: VerificationStatus,
): Promise<VerificationItemDto[]> {
  const profiles = await MemberProfileModel.find({ verificationStatus: status })
    .sort({ idSubmittedAt: status === 'pending' ? 1 : -1 })
    .limit(200)
    .lean();
  const users = await UserModel.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select('name email')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return profiles.map((p) => ({
    profileId: String(p._id),
    name: byId.get(String(p.userId))?.name ?? 'Unknown',
    email: byId.get(String(p.userId))?.email ?? '',
    phone: p.phone ?? null,
    status: p.verificationStatus,
    note: p.verificationNote ?? null,
    submittedAt: p.idSubmittedAt.toISOString(),
  }));
}

/** The ID proof file, for staff of the member's own library (tenant-scoped lookup). */
export async function openIdProof(profileId: string) {
  const profile = await MemberProfileModel.findById(parseId(profileId, 'Member'))
    .select('idProofKey')
    .lean();
  if (!profile) throw notFound('Member');
  return openFile(profile.idProofKey);
}

/** 16 digits, first digit non-zero; unique per library via the index. */
function newMembershipNo(): string {
  let n = String(randomInt(1, 10));
  for (let i = 0; i < 15; i++) n += String(randomInt(0, 10));
  return n;
}

export async function decideVerification(
  libraryId: string,
  profileId: string,
  decision: 'approve' | 'reject',
  actor: Actor,
  reason?: string,
) {
  const _id = parseId(profileId, 'Member');
  const profile = await MemberProfileModel.findById(_id);
  if (!profile) throw notFound('Member');
  if (profile.verificationStatus !== 'pending') {
    throw new AppError(
      409,
      'ALREADY_DECIDED',
      `This ID proof is already ${profile.verificationStatus}`,
    );
  }

  profile.set({
    verificationStatus: decision === 'approve' ? 'approved' : 'rejected',
    verificationNote: decision === 'reject' ? reason : null,
    verifiedBy: new Types.ObjectId(actor.id),
    verifiedAt: new Date(),
  });
  for (let attempt = 0; ; attempt++) {
    if (decision === 'approve') profile.membershipNo ??= newMembershipNo();
    try {
      await profile.save();
      break;
    } catch (err) {
      if (!isDuplicateKey(err) || attempt >= 5) throw err;
      profile.membershipNo = null;
    }
  }

  await recordAudit({
    libraryId,
    actor,
    action: decision === 'approve' ? 'member.idApproved' : 'member.idRejected',
    target: { type: 'memberProfile', id: _id },
    details: decision === 'reject' ? { reason } : { membershipNo: profile.membershipNo },
  });

  const user = await UserModel.findById(profile.userId).select('name email').lean();
  const library = await LibraryModel.findById(libraryId).select('name').lean();
  if (user) {
    await sendMail({
      to: user.email,
      subject:
        decision === 'approve'
          ? `Your ID is verified at ${library?.name}`
          : `Your ID proof at ${library?.name} needs another look`,
      text:
        decision === 'approve'
          ? `Hi ${user.name},\n\nYour ID has been verified. You can now choose a membership plan in LibraVerse.`
          : `Hi ${user.name},\n\nWe could not verify your ID proof.\n\nReason: ${reason}\n\nSign in to upload a new one.`,
    });
  }
  return toProfileDto(profile);
}
