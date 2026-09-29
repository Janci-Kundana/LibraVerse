import { Types } from 'mongoose';
import type { BranchDto } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { BranchModel } from './model';

// Runs in the caller's tenant context; management (FR-08) arrives in Phase 2.

const toDto = (b: { _id: Types.ObjectId; name: string; address?: string | null }): BranchDto => ({
  id: String(b._id),
  name: b.name,
  address: b.address ?? '',
});

export async function listBranches(): Promise<BranchDto[]> {
  return (await BranchModel.find().sort({ name: 1 }).lean()).map(toDto);
}

export async function getBranch(id: string): Promise<BranchDto> {
  const branch = Types.ObjectId.isValid(id) ? await BranchModel.findById(id).lean() : null;
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return toDto(branch);
}
