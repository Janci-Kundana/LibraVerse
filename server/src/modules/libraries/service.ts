import { Types } from 'mongoose';
import type { AdminLibraryDto, LibraryStatus, PlatformPlanCode, Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { sendMail } from '../../core/mailer';
import { runAsSystem, runWithTenant } from '../../core/tenant';
import { recordAudit } from '../audit/service';
import { issuePasswordSetupLink } from '../auth/service';
import { BranchModel } from '../branches/model';
import { PlatformPlanModel } from '../platformPlans/model';
import { SubscriptionModel } from '../subscriptions/model';
import { UserModel } from '../users/model';
import { LibraryModel } from './model';
import type { LibraryAction, RegisterLibraryInput } from './validation';

interface Actor {
  id: string;
  role: Role;
}

// Allowed moves for each Super Admin action (FR-05).
const TRANSITIONS: Record<
  LibraryAction,
  { from: LibraryStatus; to: LibraryStatus; auditAction: string }
> = {
  approve: { from: 'pending', to: 'active', auditAction: 'library.approved' },
  reject: { from: 'pending', to: 'rejected', auditAction: 'library.rejected' },
  suspend: { from: 'active', to: 'suspended', auditAction: 'library.suspended' },
  reactivate: { from: 'suspended', to: 'active', auditAction: 'library.reactivated' },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** FR-01, Free plan path: creates a pending library with its owner, main branch and subscription. */
export function registerLibrary(input: RegisterLibraryInput) {
  return runAsSystem('library:register', async () => {
    if (input.planCode !== 'free') {
      throw new AppError(
        400,
        'PLAN_NOT_AVAILABLE',
        'Pro sign-up with payment is not available yet. Start on Free and upgrade later.',
      );
    }
    const plan = await PlatformPlanModel.findOne({ code: input.planCode, active: true });
    if (!plan) throw new AppError(400, 'PLAN_NOT_AVAILABLE', 'That plan is not available');

    const slug = input.slug ?? slugify(input.libraryName);
    if (slug.length < 3) {
      throw new AppError(400, 'INVALID_SLUG', 'Choose a web address of at least 3 characters');
    }
    if (await LibraryModel.exists({ slug })) {
      throw new AppError(409, 'SLUG_TAKEN', 'That web address is taken', { field: 'slug' });
    }

    let library;
    try {
      library = await LibraryModel.create({
        name: input.libraryName,
        slug,
        ownerName: input.ownerName,
        contactEmail: input.ownerEmail,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new AppError(409, 'SLUG_TAKEN', 'That web address is taken', { field: 'slug' });
      }
      throw err;
    }

    try {
      await runWithTenant(library._id, async () => {
        await BranchModel.create({ name: input.branchName ?? 'Main branch' });
        const owner = await UserModel.create({
          name: input.ownerName,
          email: input.ownerEmail,
          role: 'libraryAdmin',
          status: 'invited',
        });
        await SubscriptionModel.create({ platformPlanId: plan._id, status: 'pending' });
        await recordAudit({
          libraryId: library._id,
          actor: null,
          action: 'library.registered',
          target: { type: 'library', id: library._id },
          details: { plan: plan.code, ownerUserId: String(owner._id) },
        });
      });
    } catch (err) {
      // No multi-document transaction here, so undo by hand.
      await Promise.all([
        LibraryModel.deleteOne({ _id: library._id }),
        BranchModel.deleteMany({ libraryId: library._id }),
        UserModel.deleteMany({ libraryId: library._id }),
        SubscriptionModel.deleteMany({ libraryId: library._id }),
      ]);
      throw err;
    }

    await sendMail({
      to: input.ownerEmail,
      subject: `We received ${input.libraryName}'s registration`,
      text: `Hi ${input.ownerName},\n\nThanks for registering ${input.libraryName} on LibraVerse. We will email you a link to set your password as soon as it is approved.`,
    });

    return { id: String(library._id), slug: library.slug, status: library.status };
  });
}

/** Super Admin view: library-level facts only, never members or books. */
export function listLibraries(filter: { status?: LibraryStatus }): Promise<AdminLibraryDto[]> {
  return runAsSystem('superAdmin:list-libraries', async () => {
    const libraries = await LibraryModel.find(filter.status ? { status: filter.status } : {})
      .sort({ createdAt: -1 })
      .lean();
    const subs = await SubscriptionModel.find({ libraryId: { $in: libraries.map((l) => l._id) } })
      .select('libraryId platformPlanId')
      .lean();
    const plans = await PlatformPlanModel.find().select('code').lean();
    const planCode = new Map(plans.map((p) => [String(p._id), p.code as PlatformPlanCode]));
    const planByLibrary = new Map(
      subs.map((s) => [String(s.libraryId), planCode.get(String(s.platformPlanId)) ?? null]),
    );
    return libraries.map((l) => ({
      id: String(l._id),
      name: l.name,
      slug: l.slug,
      status: l.status,
      ownerName: l.ownerName,
      contactEmail: l.contactEmail,
      planCode: planByLibrary.get(String(l._id)) ?? null,
      createdAt: l.createdAt.toISOString(),
      statusReason: l.statusReason ?? null,
    }));
  });
}

export function changeLibraryStatus(
  libraryId: string,
  action: LibraryAction,
  actor: Actor,
  reason?: string,
) {
  return runAsSystem(`superAdmin:${action}-library`, async () => {
    if (!Types.ObjectId.isValid(libraryId))
      throw new AppError(404, 'NOT_FOUND', 'Library not found');
    const { from, to, auditAction } = TRANSITIONS[action];

    const library = await LibraryModel.findOneAndUpdate(
      { _id: libraryId, status: from },
      { $set: { status: to, statusReason: reason ?? null } },
      { new: true },
    );
    if (!library) {
      const current = await LibraryModel.findById(libraryId).select('status').lean();
      if (!current) throw new AppError(404, 'NOT_FOUND', 'Library not found');
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Cannot ${action} a library that is ${current.status}`,
      );
    }

    await recordAudit({
      libraryId: library._id,
      actor,
      action: auditAction,
      target: { type: 'library', id: library._id },
      details: { from, to, ...(reason ? { reason } : {}) },
    });

    await afterTransition(library, action, reason);
    return { id: String(library._id), status: library.status };
  });
}

async function afterTransition(
  library: { _id: Types.ObjectId; name: string; ownerName: string; contactEmail: string },
  action: LibraryAction,
  reason?: string,
) {
  const to = library.contactEmail;
  const reasonLine = reason ? `\n\nReason: ${reason}` : '';

  if (action === 'approve') {
    await SubscriptionModel.updateOne({ libraryId: library._id }, { $set: { status: 'active' } });
    const owner = await UserModel.findOne({
      libraryId: library._id,
      role: 'libraryAdmin',
      status: 'invited',
    }).select('_id');
    if (owner) {
      const link = await issuePasswordSetupLink(owner._id);
      await sendMail({
        to,
        subject: `${library.name} is live on LibraVerse`,
        text: `Hi ${library.ownerName},\n\n${library.name} has been approved. Set your password to sign in (the link works for 48 hours):\n\n${link}`,
      });
    }
  } else if (action === 'reject') {
    await sendMail({
      to,
      subject: `${library.name}'s registration was not approved`,
      text: `Hi ${library.ownerName},\n\nWe could not approve ${library.name} on LibraVerse.${reasonLine}`,
    });
  } else if (action === 'suspend') {
    await sendMail({
      to,
      subject: `${library.name} has been suspended`,
      text: `Hi ${library.ownerName},\n\n${library.name} has been suspended on LibraVerse, so its staff and members cannot sign in.${reasonLine}`,
    });
  } else {
    await sendMail({
      to,
      subject: `${library.name} has been reactivated`,
      text: `Hi ${library.ownerName},\n\n${library.name} is active on LibraVerse again.`,
    });
  }
}
