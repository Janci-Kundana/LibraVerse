import type { Types } from 'mongoose';
import type { Role, StaffDto } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { notFound, parseId } from '../../core/ids';
import { sendMail } from '../../core/mailer';
import { recordAudit } from '../audit/service';
import { issuePasswordSetupLink } from '../auth/service';
import { SessionModel } from '../auth/sessionModel';
import { BranchModel } from '../branches/model';
import { LibraryModel } from '../libraries/model';
import { UserModel } from '../users/model';
import type { AddStaffInput } from './validation';

// FR-09: the Library Admin adds and removes librarians. Tenant context.

type Actor = { id: string; role: Role };

const toDto = (u: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  status: StaffDto['status'];
  branchId?: Types.ObjectId | null;
}): StaffDto => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  branchId: u.branchId ? String(u.branchId) : null,
});

export async function listStaff(): Promise<StaffDto[]> {
  const users = await UserModel.find({ role: { $in: ['libraryAdmin', 'librarian'] } })
    .sort({ role: 1, name: 1 })
    .lean();
  return users.map(toDto);
}

export async function addLibrarian(libraryId: string, input: AddStaffInput, actor: Actor) {
  const branchId = input.branchId ? parseId(input.branchId, 'Branch') : null;
  if (branchId && !(await BranchModel.exists({ _id: branchId }))) throw notFound('Branch');

  let user = await UserModel.findOne({ email: input.email });
  if (user && (user.role !== 'librarian' || user.status !== 'disabled')) {
    throw new AppError(409, 'EMAIL_TAKEN', 'That email already has an account in this library', {
      field: 'email',
    });
  }
  if (user) {
    // Re-adding a removed librarian: reactivate as invited with a fresh link.
    user.set({ name: input.name, branchId, status: 'invited' });
    await user.save();
  } else {
    user = await UserModel.create({
      name: input.name,
      email: input.email,
      role: 'librarian',
      branchId,
      status: 'invited',
    });
  }

  const library = await LibraryModel.findById(libraryId).select('name').lean();
  const link = await issuePasswordSetupLink(user._id);
  await sendMail({
    to: user.email,
    subject: `You have been added as a librarian at ${library?.name ?? 'a library'}`,
    text: `Hi ${user.name},\n\nYou have been added as a librarian at ${library?.name} on LibraVerse. Set your password to sign in (the link works for 48 hours):\n\n${link}`,
  });
  await recordAudit({
    libraryId,
    actor,
    action: 'staff.added',
    target: { type: 'user', id: user._id },
    details: { email: user.email, role: 'librarian' },
  });
  return toDto(user);
}

export async function removeLibrarian(libraryId: string, id: string, actor: Actor) {
  const _id = parseId(id, 'Staff member');
  if (String(_id) === actor.id)
    throw new AppError(409, 'CANNOT_REMOVE_SELF', 'You cannot remove yourself');
  const user = await UserModel.findOne({ _id, role: 'librarian' });
  if (!user) throw notFound('Librarian');
  user.status = 'disabled';
  await user.save();
  await SessionModel.updateMany(
    { userId: _id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'staff removed' } },
  );
  await recordAudit({
    libraryId,
    actor,
    action: 'staff.removed',
    target: { type: 'user', id: _id },
    details: { email: user.email },
  });
}
