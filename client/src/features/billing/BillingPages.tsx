import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlatformPlanCode, PlatformPlanDto } from '@libraverse/shared';
import {
  PageSkeleton,
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  StatusPill,
} from '../../components/ui';
import { api, errorMessage, post, put } from '../../lib/api';
import { formatDate, rupees, toPaise } from '../../lib/format';
import { openCheckout } from '../../lib/razorpay';

export interface PlatformCheckout {
  paymentId: string;
  orderId: string;
  keyId: string;
  amount: number;
  expiresAt: string;
  description: string;
}

interface SubscriptionView {
  planCode: PlatformPlanCode;
  planName: string;
  status: string;
  currentPeriodEnd: string | null;
  limits: { members: number | null; branches: number | null };
  usage: { members: number; branches: number };
  billingAvailable: boolean;
  plans: {
    code: PlatformPlanCode;
    name: string;
    monthlyPrice: number;
    memberLimit: number | null;
    branchLimit: number | null;
  }[];
  invoices: {
    id: string;
    amount: number;
    paidAt: string | null;
    purpose: string;
    refunded: boolean;
  }[];
}

/** Opens Checkout for a platform (Pro) payment. The webhook applies it. */
export function payPlatform(c: PlatformCheckout, name = 'LibraVerse') {
  return openCheckout({
    key: c.keyId,
    order_id: c.orderId,
    amount: c.amount,
    name,
    description: c.description,
    timeout: Math.max(60, Math.round((Date.parse(c.expiresAt) - Date.now()) / 1000)),
    handler: () => {},
  });
}

const limit = (n: number | null) => (n == null ? 'unlimited' : String(n));

/** FR-12: the library's platform plan. */
export function SubscriptionPage() {
  const qc = useQueryClient();
  const key = ['library', 'subscription'];
  const sub = useQuery({
    queryKey: key,
    queryFn: () => api<SubscriptionView>('/api/library/subscription'),
    refetchInterval: 10_000,
  });
  const [waiting, setWaiting] = useState(false);
  const upgrade = useMutation({
    mutationFn: async () => {
      const c = await post<PlatformCheckout>('/api/library/subscription/upgrade');
      setWaiting(true);
      await payPlatform(c);
    },
  });
  const downgrade = useMutation({
    mutationFn: () => post<SubscriptionView>('/api/library/subscription/downgrade'),
    onSuccess: (d) => qc.setQueryData(key, d),
  });
  if (!sub.data) return <PageSkeleton />;
  const s = sub.data;
  const pro = s.plans.find((p) => p.code === 'pro');

  return (
    <div className="max-w-3xl">
      <PageHeader title="Subscription" />
      <Card>
        <p className="text-lg font-semibold">{s.planName} plan</p>
        <p className="text-sm text-gray-400">
          {s.currentPeriodEnd
            ? `Paid until ${formatDate(s.currentPeriodEnd)}`
            : s.planCode === 'free'
              ? 'Free forever'
              : ''}
        </p>
        <p className="mt-3 text-sm text-gray-300">
          Members {s.usage.members} / {limit(s.limits.members)} · Branches {s.usage.branches} /{' '}
          {limit(s.limits.branches)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {pro && s.billingAvailable && (
            <Button busy={upgrade.isPending} onClick={() => upgrade.mutate()}>
              {s.planCode === 'pro'
                ? `Pay next month (${rupees(pro.monthlyPrice)})`
                : `Upgrade to Pro (${rupees(pro.monthlyPrice)}/month)`}
            </Button>
          )}
          {s.planCode === 'pro' && (
            <Button
              variant="secondary"
              busy={downgrade.isPending}
              onClick={() => downgrade.mutate()}
            >
              Switch to Free
            </Button>
          )}
        </div>
        {!s.billingAvailable && (
          <p className="mt-2 text-sm text-gray-500">
            Pro payments are not enabled on this platform yet.
          </p>
        )}
        {waiting && s.planCode !== 'pro' && (
          <p role="status" className="mt-3 text-sm text-gray-300">
            Once Razorpay confirms the payment, Pro switches on here automatically.
          </p>
        )}
        <div className="mt-3">
          <ErrorText>
            {upgrade.error
              ? errorMessage(upgrade.error)
              : downgrade.error
                ? errorMessage(downgrade.error)
                : ''}
          </ErrorText>
        </div>
      </Card>
      <h2 className="mt-8 text-lg font-semibold">Invoices</h2>
      {s.invoices.length === 0 && <p className="text-sm text-gray-400">No payments yet.</p>}
      <ul className="mt-2 divide-y divide-gray-800">
        {s.invoices.map((i) => (
          <li key={i.id} className="flex justify-between py-2 text-sm">
            <span>
              {formatDate(i.paidAt)} · Pro ({i.purpose})
            </span>
            <span>
              {rupees(i.amount)}
              {i.refunded && ' · refunded'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FR-06: the Super Admin edits platform plans. */
export function AdminPlansPage() {
  const qc = useQueryClient();
  const plans = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: () => api<PlatformPlanDto[]>('/api/admin/plans'),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Platform plans" />
      <div className="space-y-4">
        {plans.data?.map((p) => (
          <PlanEditor
            key={p.id}
            plan={p}
            onSaved={() => void qc.invalidateQueries({ queryKey: ['admin', 'plans'] })}
          />
        ))}
      </div>
    </div>
  );
}

function PlanEditor({ plan, onSaved }: { plan: PlatformPlanDto; onSaved: () => void }) {
  const [f, setF] = useState({
    name: plan.name,
    price: String(plan.monthlyPrice / 100),
    members: plan.memberLimit == null ? '' : String(plan.memberLimit),
    branches: plan.branchLimit == null ? '' : String(plan.branchLimit),
  });
  const save = useMutation({
    mutationFn: () =>
      put(`/api/admin/plans/${plan.id}`, {
        name: f.name,
        monthlyPrice: toPaise(f.price),
        memberLimit: f.members ? Number(f.members) : null,
        branchLimit: f.branches ? Number(f.branches) : null,
        active: plan.active,
      }),
    onSuccess: onSaved,
  });
  return (
    <Card>
      <p className="mb-3 font-medium">
        {plan.code.toUpperCase()}{' '}
        <StatusPill tone={plan.active ? 'green' : 'gray'}>
          {plan.active ? 'on sale' : 'hidden'}
        </StatusPill>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="grid gap-3 sm:grid-cols-4"
      >
        <Field label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field
          label="Price / month (₹)"
          type="number"
          min="0"
          step="0.01"
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
        />
        <Field
          label="Member limit"
          type="number"
          min="1"
          placeholder="unlimited"
          value={f.members}
          onChange={(e) => setF({ ...f, members: e.target.value })}
        />
        <Field
          label="Branch limit"
          type="number"
          min="1"
          placeholder="unlimited"
          value={f.branches}
          onChange={(e) => setF({ ...f, branches: e.target.value })}
        />
        <div className="sm:col-span-4 flex items-center gap-3">
          <Button type="submit" busy={save.isPending}>
            Save {plan.code}
          </Button>
          {save.isSuccess && <span className="text-sm text-emerald-400">Saved</span>}
          <ErrorText>{save.error ? errorMessage(save.error) : ''}</ErrorText>
        </div>
      </form>
    </Card>
  );
}
