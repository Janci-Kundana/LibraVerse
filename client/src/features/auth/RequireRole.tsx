import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { homePathFor, roleSatisfies, type Role } from '@libraverse/shared';
import { FullPageMessage } from '../../components/FullPageMessage';
import { useMe } from './useAuth';

/** Client-side mirror of the server's requireRole: redirects instead of rendering. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) return <FullPageMessage>Loading…</FullPageMessage>;
  if (isError)
    return <FullPageMessage>Could not reach the server. Try again shortly.</FullPageMessage>;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!roleSatisfies(user.role, roles)) return <Navigate to={homePathFor(user.role)} replace />;
  return children;
}
