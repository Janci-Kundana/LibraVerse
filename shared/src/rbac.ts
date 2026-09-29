import type { Role } from './enums';

// A role also holds every permission of the roles listed for it here.
const INHERITS: Partial<Record<Role, Role[]>> = {
  libraryAdmin: ['librarian'],
};

/** True when `role` is one of `allowed`, directly or through inheritance. */
export function roleSatisfies(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role) || (INHERITS[role] ?? []).some((r) => allowed.includes(r));
}

export function isStaff(role: Role): boolean {
  return role !== 'member';
}

/** Where each role lands after login. */
export function homePathFor(role: Role): string {
  switch (role) {
    case 'superAdmin':
      return '/admin';
    case 'libraryAdmin':
    case 'librarian':
      return '/library';
    case 'member':
      return '/member';
  }
}
