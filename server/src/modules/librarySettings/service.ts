import type {
  LibrarySettingsDto,
  PlatformPlanCode,
  PublicLibraryDto,
  Role,
} from '@libraverse/shared';
import { notFound } from '../../core/ids';
import { decodeDataUrl, putFile } from '../../core/storage';
import { recordAudit } from '../audit/service';
import { LibraryModel } from '../libraries/model';
import { PlatformPlanModel } from '../platformPlans/model';
import { SubscriptionModel } from '../subscriptions/model';
import type { UpdateSettingsInput } from './validation';

// Runs in the admin's tenant context. `libraries` is platform-level, so it is
// addressed by the caller's own libraryId, never by an id from the request.

export async function currentPlan() {
  const sub = await SubscriptionModel.findOne().select('platformPlanId').lean();
  return sub ? PlatformPlanModel.findById(sub.platformPlanId).lean() : null;
}

export async function getSettings(libraryId: string): Promise<LibrarySettingsDto> {
  const library = await LibraryModel.findById(libraryId).lean();
  if (!library) throw notFound('Library');
  const plan = await currentPlan();
  return {
    id: String(library._id),
    name: library.name,
    slug: library.slug,
    logoUrl: library.logoUrl ?? null,
    cardColours: library.cardColours,
    circulation: {
      loanDays: library.circulation?.loanDays ?? 14,
      maxRenewals: library.circulation?.maxRenewals ?? 2,
      holdDays: library.circulation?.holdDays ?? 3,
      lostBookCharge: library.circulation?.lostBookCharge ?? 50_000,
    },
    planCode: (plan?.code as PlatformPlanCode | undefined) ?? null,
    branchLimit: plan?.branchLimit ?? null,
  };
}

export async function updateSettings(
  libraryId: string,
  input: UpdateSettingsInput,
  actor: { id: string; role: Role },
) {
  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.cardColours !== undefined) set.cardColours = input.cardColours;
  if (input.circulation !== undefined) set.circulation = input.circulation;
  if (input.logo === null) set.logoUrl = null;
  else if (input.logo !== undefined) {
    const file = decodeDataUrl(input.logo, {
      allowed: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 2 * 1024 * 1024,
    });
    set.logoUrl = (await putFile(file, `logos/${libraryId}`, 'public')).url;
  }
  if (Object.keys(set).length > 0) {
    await LibraryModel.updateOne({ _id: libraryId }, { $set: set });
    await recordAudit({
      libraryId,
      actor,
      action: 'library.settingsUpdated',
      target: { type: 'library', id: libraryId },
      details: { fields: Object.keys(set) },
    });
  }
  return getSettings(libraryId);
}

/** Public directory of active libraries for the member "Join a library" page. */
export async function listPublicLibraries(q?: string): Promise<PublicLibraryDto[]> {
  const filter: Record<string, unknown> = { status: 'active' };
  if (q) {
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { name: { $regex: safe, $options: 'i' } },
      { slug: { $regex: safe, $options: 'i' } },
    ];
  }
  const libs = await LibraryModel.find(filter).sort({ name: 1 }).limit(50).lean();
  return libs.map((l) => ({ name: l.name, slug: l.slug, logoUrl: l.logoUrl ?? null }));
}

export async function getPublicLibrary(slug: string): Promise<PublicLibraryDto> {
  const l = await LibraryModel.findOne({ slug, status: 'active' }).lean();
  if (!l) throw notFound('Library');
  return { name: l.name, slug: l.slug, logoUrl: l.logoUrl ?? null };
}
