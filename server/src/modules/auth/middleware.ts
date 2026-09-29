import type { Request, RequestHandler } from 'express';
import { roleSatisfies, type Role } from '@libraverse/shared';
import { AppError } from '../../core/errors';
import { enterTenant } from '../../core/tenant';
import { ACCESS_COOKIE, verifyAccess } from './tokens';

/**
 * Requires a valid access token and, for library users, runs the rest of the
 * request inside that library's tenant context. The Super Admin gets no tenant
 * context, so any tenant query it makes without `runAsSystem` throws.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  if (typeof token !== 'string' || !token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
  }
  const claims = verifyAccess(token);
  req.auth = { userId: claims.sub, role: claims.role, libraryId: claims.lib };
  if (claims.lib) enterTenant(claims.lib, next);
  else next();
};

/** Allows the listed roles; libraryAdmin also passes wherever librarian is allowed. */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    if (!roleSatisfies(req.auth.role, allowed)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this');
    }
    next();
  };
}

/** The signed-in user as an audit-log actor. */
export function actorOf(req: Request): { id: string; role: Role } {
  if (!req.auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
  return { id: req.auth.userId, role: req.auth.role };
}

/** The signed-in user's library id; throws for the Super Admin. */
export function libraryOf(req: Request): string {
  if (!req.auth?.libraryId) throw new AppError(403, 'FORBIDDEN', 'Library account required');
  return req.auth.libraryId;
}
