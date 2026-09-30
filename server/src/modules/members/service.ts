import { randomInt } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  CelebrationDto,
  MemberProfileDto,
  MemberRowDto,
  MemberStandingDto,
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
import { circulationSettings } from '../circulation/rules';
import { depositHistory, outstandingDues, standing } from '../dues/service';
import { LibraryModel } from '../libraries/model';
import { PaymentModel } from '../payments/model';
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
    const photo = input.photo
      ? await putFile(
          decodeDataUrl(input.photo, { allowed: PHOTO_TYPES, maxBytes: 2 * 1024 * 1024 }),
          `photos/${String(library._id)}`,
          'private',
        )
      : null;
    await MemberProfileModel.create({
      userId: user._id,
      phone: input.phone ?? null,
      photoKey: photo?.key ?? null,
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

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Profile picture: private, shown on the card and to this library's staff. */
export async function setPhoto(userId: string, dataUrl: string) {
  const profile = await profileFor(userId);
  const file = decodeDataUrl(dataUrl, { allowed: PHOTO_TYPES, maxBytes: 2 * 1024 * 1024 });
  const stored = await putFile(file, `photos/${String(profile.libraryId)}`, 'private');
  profile.photoKey = stored.key;
  await profile.save();
  return toProfileDto(profile);
}

export async function openMyPhoto(userId: string) {
  const profile = await profileFor(userId);
  if (!profile.photoKey) throw notFound('Photo');
  return openFile(profile.photoKey);
}

export async function openMemberPhoto(profileId: string) {
  const profile = await MemberProfileModel.findById(parseId(profileId, 'Member'))
    .select('photoKey')
    .lean();
  if (!profile?.photoKey) throw notFound('Photo');
  return openFile(profile.photoKey);
}

/** Deposit, dues and the reminder cycle, as the member sees them. */
export async function myStanding(libraryId: string, userId: string): Promise<MemberStandingDto> {
  const profile = await profileFor(userId);
  const memberId = new Types.ObjectId(userId);
  const due = await outstandingDues(memberId);
  const { cardStatus, dueStatus } = standing(profile, due);
  const { depositAmount } = await circulationSettings(libraryId);
  return {
    cardStatus,
    dueStatus,
    outstandingDues: due,
    depositBalance: profile.depositBalance ?? 0,
    depositAmount,
    warningsSent: profile.dues?.warningsSent ?? 0,
    deductionScheduledFor: profile.dues?.deductionScheduledFor?.toISOString() ?? null,
    history: await depositHistory(memberId),
  };
}

/** The membership to celebrate once, only after a confirmed payment. */
export async function pendingCelebration(userId: string): Promise<CelebrationDto | null> {
  const profile = await profileFor(userId);
  if (!profile.celebratePaymentId) return null;
  const payment = await PaymentModel.findOne({
    _id: profile.celebratePaymentId,
    status: 'success',
    purpose: 'membership',
  }).lean();
  if (!payment) return null;
  const plan = payment.planId
    ? await MembershipPlanModel.findById(payment.planId).select('name').lean()
    : null;
  const earlier = await PaymentModel.countDocuments({
    memberId: payment.memberId,
    purpose: 'membership',
    status: 'success',
    _id: { $ne: payment._id },
    paidAt: { $lt: payment.paidAt ?? new Date() },
  });
  return {
    paymentId: String(payment._id),
    planName: plan?.name ?? 'Membership',
    tier: profile.cardTier,
    validTill: profile.validTill ? profile.validTill.toISOString() : null,
    amount: payment.amount,
    depositCollected: payment.depositAmount ?? 0,
    renewal: earlier > 0,
  };
}

export async function celebrationSeen(userId: string, paymentId: string) {
  await MemberProfileModel.updateOne(
    { userId: new Types.ObjectId(userId), celebratePaymentId: parseId(paymentId, 'Payment') },
    { $set: { celebratePaymentId: null } },
  );
}

/** Staff: members with their standing (dues, deposit, card status). */
export async function listMembers(q?: string) {
  const userFilter: Record<string, unknown> = { role: 'member' };
  if (q) {
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    userFilter.$or = [{ name: rx }, { email: rx }];
  }
  const users = await UserModel.find(userFilter)
    .select('name email status')
    .sort({ name: 1 })
    .limit(300)
    .lean();
  const profiles = await MemberProfileModel.find({
    userId: { $in: users.map((u) => u._id) },
  }).lean();
  const plans = await MembershipPlanModel.find({
    _id: { $in: profiles.map((p) => p.planId).filter(Boolean) },
  })
    .select('name')
    .lean();
  const planName = new Map(plans.map((p) => [String(p._id), p.name]));
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  const rows: MemberRowDto[] = [];
  for (const u of users) {
    const p = byUser.get(String(u._id));
    if (!p) continue;
    const due = await outstandingDues(u._id);
    const s = standing(p, due);
    rows.push({
      profileId: String(p._id),
      name: u.name,
      email: u.email,
      phone: p.phone ?? null,
      accountStatus: u.status,
      verificationStatus: p.verificationStatus,
      membershipNo: p.membershipNo ?? null,
      planName: p.planId ? (planName.get(String(p.planId)) ?? null) : null,
      validTill: p.validTill ? p.validTill.toISOString() : null,
      outstandingDues: due,
      depositBalance: p.depositBalance ?? 0,
      cardStatus: s.cardStatus,
      dueStatus: s.dueStatus,
      hasPhoto: p.photoKey != null,
    });
  }
  return rows;
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
