import type { ReactNode } from 'react';
import { PageSkeleton, ErrorText } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useMemberProfile, VerificationPending } from './MemberHome';

/** Member pages beyond Home need an approved ID; the server enforces the same rule. */
export function VerifiedOnly({ children }: { children: ReactNode }) {
  const profile = useMemberProfile();
  if (profile.isPending) return <PageSkeleton />;
  if (profile.isError) return <ErrorText>{errorMessage(profile.error)}</ErrorText>;
  if (profile.data.verificationStatus !== 'approved')
    return <VerificationPending profile={profile.data} />;
  return children;
}
