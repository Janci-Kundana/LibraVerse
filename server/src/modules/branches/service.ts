import type { Types } from 'mongoose';
import type { BranchDto, Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { isDuplicateKey, notFound, parseId } from '../../core/ids';
import { recordAudit } from '../audit/service';
import { currentPlan } from '../librarySettings/service';
import { UserModel } from '../users/model';
import { BranchModel } from './model';
import type { BranchInput } from './validation';

// Runs in the caller's tenant context (FR-08).

type Actor = { id: string; role: Role };

const toDto = (b: { _id: Types.ObjectId; name: string; address?: string | null }): BranchDto => ({
  id: String(b._id),
  name: b.name,
  address: b.address ?? '',
});

const nameTaken = () =>
  new AppError(409, 'NAME_TAKEN', 'A branch with that name already exists', { field: 'name' });

export async function listBranches(): Promise<BranchDto[]> {
  return (await BranchModel.find().sort({ name: 1 }).lean()).map(toDto);
}

export async function getBranch(id: string): Promise<BranchDto> {
  const branch = await BranchModel.findById(parseId(id, 'Branch')).lean();
  if (!branch) throw notFound('Branch');
  return toDto(branch);
}

export async function createBranch(libraryId: string, input: BranchInput, actor: Actor) {
  const plan = await currentPlan();
  if (plan?.branchLimit != null && (await BranchModel.countDocuments()) >= plan.branchLimit) {
    throw new AppError(
      403,
      'PLAN_LIMIT',
      `Your ${plan.name} plan allows ${plan.branchLimit} branch${plan.branchLimit === 1 ? '' : 'es'}. Upgrade to add more.`,
    );
  }
  try {
    const branch = await BranchModel.create(input);
    await recordAudit({
      libraryId,
      actor,
      action: 'branch.created',
      target: { type: 'branch', id: branch._id },
      details: { name: branch.name },
    });
    return toDto(branch);
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
}

export async function updateBranch(id: string, input: BranchInput) {
  try {
    const branch = await BranchModel.findOneAndUpdate({ _id: parseId(id, 'Branch') }, input, {
      new: true,
      runValidators: true,
    }).lean();
    if (!branch) throw notFound('Branch');
    return toDto(branch);
  } catch (err) {
    if (isDuplicateKey(err)) throw nameTaken();
    throw err;
  }
}

export async function deleteBranch(libraryId: string, id: string, actor: Actor) {
  const _id = parseId(id, 'Branch');
  if ((await BranchModel.countDocuments()) <= 1) {
    throw new AppError(409, 'LAST_BRANCH', 'A library needs at least one branch');
  }
  if (await UserModel.exists({ branchId: _id, status: { $ne: 'disabled' } })) {
    throw new AppError(409, 'BRANCH_IN_USE', 'Move the staff assigned to this branch first');
  }
  const branch = await BranchModel.findOneAndDelete({ _id }).lean();
  if (!branch) throw notFound('Branch');
  await recordAudit({
    libraryId,
    actor,
    action: 'branch.deleted',
    target: { type: 'branch', id: _id },
    details: { name: branch.name },
  });
}
