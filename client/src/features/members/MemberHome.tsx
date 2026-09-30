import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberCardDto, MemberProfileDto, MembershipPlanDto } from '@libraverse/shared';
import { Link } from 'react-router';
import { Icon, type IconName } from '../../components/icons';
import { Button, Card, ErrorText, PageSkeleton } from '../../components/ui';
import { useCardFaces } from '../card/useCardFaces';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, readFileAsDataUrl, rupees } from '../../lib/format';
import { HomeShell } from '../dashboard/DashboardLayout';
import { PayButton } from '../payments/MemberPayments';
import { NotificationsToggle } from '../dashboard/NotificationsToggle';
import { PhotoUploader, StandingPanel } from './StandingPanel';

export const PROFILE_KEY = ['member', 'profile'] as const;

export function useMemberProfile() {
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => api<MemberProfileDto>('/api/member/profile'),
  });
}

const TIER_STYLE: Record<string, { ring: string; chip: string; glow: string }> = {
  member: {
    ring: 'from-gray-300/60 to-gray-500/30',
    chip: 'bg-gray-200/15 text-gray-200',
    glow: 'rgb(200 205 220 / 0.25)',
  },
  gold: {
    ring: 'from-gold-300 to-gold-500',
    chip: 'bg-gold-400/15 text-gold-200',
    glow: 'rgb(226 187 102 / 0.35)',
  },
  premium: {
    ring: 'from-brand-400 to-brand-700',
    chip: 'bg-brand-500/15 text-brand-200',
    glow: 'rgb(226 41 74 / 0.35)',
  },
  elite: {
    ring: 'from-gray-500 to-gray-950',
    chip: 'bg-white/10 text-gray-100',
    glow: 'rgb(255 255 255 / 0.12)',
  },
};

const QUICK: { to: string; label: string; hint: string; icon: IconName }[] = [
  { to: '/member/card', label: 'My card', hint: 'Show it at the counter', icon: 'card' },
  { to: '/member/catalog', label: 'Find a book', hint: 'Search and reserve', icon: 'search' },
  { to: '/member/loans', label: 'My books', hint: 'Due dates and renewals', icon: 'book' },
  {
    to: '/member/assistant',
    label: 'Ask the library',
    hint: 'AI answers in seconds',
    icon: 'sparkles',
  },
];

/** The member's own card, drawn from their real data, floating in the hero. */
function HeroCard() {
  const card = useQuery({
    queryKey: ['member', 'card'],
    queryFn: () => api<MemberCardDto>('/api/member/card'),
    retry: false,
  });
  const faces = useCardFaces(card.data);
  if (!faces) return <div className="skeleton aspect-[1.586] w-full max-w-sm" />;
  return (
    <Link to="/member/card" aria-label="Open my card" className="block">
      <img
        src={faces.front.toDataURL()}
        alt="Your membership card"
        className="w-full max-w-sm animate-float rounded-2xl shadow-[0_30px_80px_-24px_rgb(0_0_0/0.9)] transition duration-500 [transform:perspective(900px)_rotateY(-12deg)_rotateX(6deg)] hover:[transform:perspective(900px)_rotateY(0deg)_rotateX(0deg)]"
      />
    </Link>
  );
}

export function MemberHome() {
  const profile = useMemberProfile();
  if (profile.isPending) return <PageSkeleton />;
  if (profile.isError) return <ErrorText>{errorMessage(profile.error)}</ErrorText>;
  const p = profile.data;
  if (p.verificationStatus !== 'approved') return <VerificationPending profile={p} />;
  const tier = TIER_STYLE[p.cardTier] ?? TIER_STYLE.member!;

  return (
    <HomeShell title="Home">
      <section className="glass relative mt-6 overflow-hidden rounded-3xl p-6 sm:p-8">
        <div
          aria-hidden
          className="absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ background: tier.glow }}
        />
        <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${tier.chip}`}
              >
                {p.cardTier} tier
              </span>
              {p.badges.includes('contributor') && (
                <span className="rounded-full bg-gold-400/15 px-3 py-1 text-xs font-semibold text-gold-200">
                  ★ Contributor
                </span>
              )}
            </div>
            <p className="mt-4 text-sm text-gray-400">Membership number</p>
            <p className="mt-1 font-mono text-xl tracking-[0.18em] sm:text-2xl">
              {p.membershipNo?.replace(/(\d{4})(?=\d)/g, '$1 ')}
            </p>
            <p className="mt-3 text-gray-300">
              {p.planName ? (
                <>
                  <span className="font-semibold text-white">{p.planName}</span> · valid till{' '}
                  {formatDate(p.validTill)}
                  {p.nextPlan && (
                    <span className="mt-1 block text-sm text-gold-200">
                      Then {p.nextPlan.planName} from {formatDate(p.nextPlan.startsAt)}
                    </span>
                  )}
                </>
              ) : (
                'No active membership plan yet. Pick one below to start borrowing.'
              )}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {QUICK.map((q) => (
                <Link
                  key={q.to}
                  to={q.to}
                  className="group rounded-2xl border border-white/8 bg-white/[0.03] p-3 transition hover:-translate-y-0.5 hover:border-brand-400/40 hover:bg-white/[0.06]"
                >
                  <Icon
                    name={q.icon}
                    className="h-5 w-5 text-brand-300 transition group-hover:scale-110"
                  />
                  <p className="mt-2 text-sm font-semibold">{q.label}</p>
                  <p className="text-xs text-gray-500">{q.hint}</p>
                </Link>
              ))}
            </div>
          </div>
          <div className="mx-auto w-full max-w-sm">
            <HeroCard />
          </div>
        </div>
      </section>
      <PhotoUploader profile={p} />
      <StandingPanel />
      <PlanList profile={p} />
      <section className="mt-10">
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="mb-3 text-sm text-gray-400">Due dates, reserved books ready, payments.</p>
        <NotificationsToggle />
      </section>
    </HomeShell>
  );
}

/**
 * What buying this plan does now: plan changes take effect when the current
 * period ends, and only one change can be waiting at a time.
 */
function planNote(plan: MembershipPlanDto, p: MemberProfileDto, now: number) {
  const running = p.validTill != null && new Date(p.validTill).getTime() > now;
  if (!running) return { blocked: false, note: null };
  if (p.nextPlan) {
    return plan.id === p.nextPlan.planId
      ? {
          blocked: false,
          note: `Adds ${plan.durationDays} days to ${plan.name}, which starts ${formatDate(p.nextPlan.startsAt)}`,
        }
      : {
          blocked: true,
          note: `${p.nextPlan.planName} already starts on ${formatDate(p.nextPlan.startsAt)}. You can change again after that.`,
        };
  }
  return plan.id === p.planId
    ? { blocked: false, note: `Adds ${plan.durationDays} days after ${formatDate(p.validTill)}` }
    : {
        blocked: false,
        note: `Starts ${formatDate(p.validTill)}, when your ${p.planName ?? 'current'} plan ends`,
      };
}

function PlanList({ profile }: { profile: MemberProfileDto }) {
  const renewing = Boolean(profile.planName);
  const [now] = useState(() => Date.now());
  const plans = useQuery({
    queryKey: ['member', 'plans'],
    queryFn: () => api<MembershipPlanDto[]>('/api/member/plans'),
  });
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">
        {renewing ? 'Renew or change plan' : 'Membership plans'}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.data?.map((plan) => {
          const t = TIER_STYLE[plan.tier] ?? TIER_STYLE.member!;
          const { blocked, note } = planNote(plan, profile, now);
          return (
            <div key={plan.id} className={`rounded-2xl bg-gradient-to-br p-px ${t.ring}`}>
              <div className="flex h-full flex-col rounded-[15px] bg-[#0b0f1e]/95 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{plan.name}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${t.chip}`}
                  >
                    {plan.tier}
                  </span>
                </div>
                <p className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold">
                  {rupees(plan.price)}
                </p>
                <ul className="mt-4 space-y-2 text-sm text-gray-300">
                  {[
                    `${plan.durationDays} days`,
                    `${plan.bookLimit} books at a time`,
                    `${rupees(plan.finePerDay)}/day late`,
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Icon name="check" className="h-4 w-4 text-emerald-400" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  {note && (
                    <p className={`mb-3 text-xs ${blocked ? 'text-gray-500' : 'text-gold-200'}`}>
                      {note}
                    </p>
                  )}
                  {!blocked && (
                    <PayButton
                      charge={{ purpose: 'membership', planId: plan.id }}
                      label={`Buy for ${rupees(plan.price)}`}
                      withCoupon
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
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
