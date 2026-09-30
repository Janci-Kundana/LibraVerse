import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberProfileDto, MembershipPlanDto } from '@libraverse/shared';
import { Button, Card, ErrorText } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, readFileAsDataUrl, rupees } from '../../lib/format';
import { HomeShell } from '../dashboard/DashboardLayout';
import { PayButton } from '../payments/MemberPayments';
import { NotificationsToggle } from '../dashboard/NotificationsToggle';

export const PROFILE_KEY = ['member', 'profile'] as const;

export function useMemberProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => api<MemberProfileDto>('/api/member/profile'),
  });
}

export function MemberHome() {
  const profile = useMemberProfile();
  if (profile.isPending) return <p className="text-gray-400">Loading…</p>;
  if (profile.isError) return <ErrorText>{errorMessage(profile.error)}</ErrorText>;
  const p = profile.data;
  if (p.verificationStatus !== 'approved') return <VerificationPending profile={p} />;

  return (
    <HomeShell title="Home">
      <Card className="mt-6 max-w-xl">
        <p className="text-sm text-gray-400">Membership number</p>
        <p className="font-mono text-lg tracking-widest">
          {p.membershipNo?.replace(/(\d{4})(?=\d)/g, '$1 ')}
        </p>
        <p className="mt-3 text-sm text-gray-400">
          {p.planName
            ? `${p.planName} · valid till ${formatDate(p.validTill)}`
            : 'No active membership plan yet.'}
        </p>
      </Card>
      <PlanList renewing={Boolean(p.planName)} />
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mb-2 text-sm text-gray-400">Due dates, reserved books ready, payments.</p>
        <NotificationsToggle />
      </section>
    </HomeShell>
  );
}

function PlanList({ renewing }: { renewing: boolean }) {
  const plans = useQuery({
    queryKey: ['member', 'plans'],
    queryFn: () => api<MembershipPlanDto[]>('/api/member/plans'),
  });
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">
        {renewing ? 'Renew or change plan' : 'Membership plans'}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.data?.map((plan) => (
          <Card key={plan.id}>
            <p className="font-medium">{plan.name}</p>
            <p className="text-2xl font-semibold">{rupees(plan.price)}</p>
            <p className="text-sm text-gray-400">
              {plan.durationDays} days · {plan.bookLimit} books at a time ·{' '}
              {rupees(plan.finePerDay)}/day late
            </p>
            <div className="mt-3">
              <PayButton
                charge={{ purpose: 'membership', planId: plan.id }}
                label={`Buy for ${rupees(plan.price)}`}
                withCoupon
              />
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** Shown until staff approve the member's ID proof. */
export function VerificationPending({ profile }: { profile: MemberProfileDto }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const resubmit = useMutation({
    mutationFn: async () =>
      post<MemberProfileDto>('/api/member/id-proof', { idProof: await readFileAsDataUrl(file!) }),
    onSuccess: (p) => qc.setQueryData(PROFILE_KEY, p),
  });
  const rejected = profile.verificationStatus === 'rejected';

  return (
    <div className="mx-auto max-w-lg py-8 text-center">
      <h1 className="text-2xl font-semibold">
        {rejected ? 'ID proof not accepted' : 'Verification pending'}
      </h1>
      <p className="mt-3 text-gray-400">
        {rejected
          ? 'The library could not verify your ID proof. Upload a clearer one to try again.'
          : 'The library staff are checking your ID proof. Once approved, you can choose a membership plan and get your card. We will email you.'}
      </p>
      {rejected && (
        <Card className="mt-6 text-left">
          {profile.verificationNote && (
            <p className="text-sm text-gray-300">Reason: {profile.verificationNote}</p>
          )}
          <label className="mt-4 block text-sm text-gray-300">
            New ID proof
            <input
              type="file"
              aria-label="New ID proof"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <div className="mt-3">
            <ErrorText>{resubmit.error ? errorMessage(resubmit.error) : ''}</ErrorText>
          </div>
          <Button
            className="mt-3"
            disabled={!file}
            busy={resubmit.isPending}
            onClick={() => resubmit.mutate()}
          >
            Upload again
          </Button>
        </Card>
      )}
    </div>
  );
}
