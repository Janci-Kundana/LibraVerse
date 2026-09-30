import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckoutDto, PaymentDto } from '@libraverse/shared';
import { Button, Card, ErrorText, Field, PageHeader, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';
import { openCheckout } from '../../lib/razorpay';
import { mmss, useCountdown, usePaymentStatus } from './usePaymentStatus';

type Charge = { purpose: 'membership'; planId: string; couponCode?: string } | { purpose: 'fine' };

/**
 * FR-20/23: buy a plan or pay fines online. Opens Razorpay Checkout with a
 * countdown, then waits for the server (webhook) to report the result live.
 */
export function PayButton({
  charge,
  label,
  withCoupon = false,
}: {
  charge: Charge;
  label: string;
  withCoupon?: boolean;
}) {
  const qc = useQueryClient();
  const [coupon, setCoupon] = useState('');
  const [checkout, setCheckout] = useState<CheckoutDto | null>(null);
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['member'] }), [qc]);
  const start = useMutation({
    mutationFn: () =>
      post<CheckoutDto>('/api/member/payments', {
        ...charge,
        ...(charge.purpose === 'membership' && coupon.trim() ? { couponCode: coupon.trim() } : {}),
      }),
    onSuccess: async (c) => {
      setCheckout(c);
      await post(`/api/member/payments/${c.payment.id}/opened`).catch(() => {});
      await openCheckout({
        key: c.keyId,
        order_id: c.orderId,
        amount: c.payment.amount,
        name: c.libraryName,
        description: c.payment.planName ? `Membership: ${c.payment.planName}` : 'Library fines',
        prefill: c.prefill,
        timeout: Math.max(60, Math.round((Date.parse(c.payment.expiresAt) - Date.now()) / 1000)),
        // Razorpay says it's done: ask the server to confirm with Razorpay.
        handler: () => {
          void post(`/api/member/payments/${c.payment.id}/verify`)
            .then(refresh)
            .catch(() => {});
        },
        // Closed without paying: the server checks, then ends the request.
        modal: {
          ondismiss: () => {
            void post(`/api/member/payments/${c.payment.id}/cancel`)
              .then(refresh)
              .catch(() => {});
          },
        },
      }).catch(() => {});
    },
  });

  if (checkout) {
    return (
      <PaymentWaiting
        payment={checkout.payment}
        onDone={refresh}
        onRetry={() => setCheckout(null)}
      />
    );
  }
  return (
    <div className="space-y-2">
      {withCoupon && (
        <Field
          label="Coupon (optional)"
          value={coupon}
          onChange={(e) => setCoupon(e.target.value.toUpperCase())}
        />
      )}
      <Button busy={start.isPending} onClick={() => start.mutate()}>
        {label}
      </Button>
      <ErrorText>{start.error ? errorMessage(start.error) : ''}</ErrorText>
    </div>
  );
}

function PaymentWaiting({
  payment,
  onDone,
  onRetry,
}: {
  payment: PaymentDto;
  onDone: () => void;
  onRetry: () => void;
}) {
  const [status] = usePaymentStatus(
    payment.id,
    payment.status,
    `/api/member/payments/${payment.id}/verify`,
  );
  const left = useCountdown(payment.expiresAt);
  useEffect(() => {
    if (status === 'success') onDone();
  }, [status, onDone]);

  if (status === 'success') {
    return (
      <div
        role="status"
        className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-4 text-emerald-100"
      >
        <p className="text-lg font-semibold">
          {payment.purpose === 'membership' ? 'Membership Activated' : 'Fines paid'}
        </p>
        <p className="text-sm">
          {rupees(payment.amount)} received. Your receipt is on its way by email.
        </p>
        {payment.purpose === 'membership' && (
          <Link to="/member/card" className="mt-2 inline-block text-sm font-medium underline">
            See your card
          </Link>
        )}
      </div>
    );
  }
  if (status === 'failed' || status === 'expired' || left === 0) {
    return (
      <div role="alert" className="rounded-xl border border-red-900 bg-red-950/50 p-4 text-red-100">
        <p className="font-semibold">
          {status === 'failed' ? 'Payment failed' : 'Payment request expired'}
        </p>
        <p className="text-sm">No money was taken for this request.</p>
        <Button className="mt-2" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <div role="status" className="rounded-xl border border-gray-700 p-4">
      <p className="font-medium">Waiting for payment of {rupees(payment.amount)}…</p>
      <p className="text-sm text-gray-400">
        Complete it in the Razorpay window. Time left:{' '}
        <span className="font-mono">{mmss(left)}</span>
      </p>
    </div>
  );
}

const TONE = {
  success: 'green',
  created: 'yellow',
  pending: 'yellow',
  failed: 'red',
  expired: 'gray',
} as const;

export function MyPaymentsPage() {
  const list = useQuery({
    queryKey: ['member', 'payments'],
    queryFn: () => api<PaymentDto[]>('/api/member/payments'),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Payments" icon="wallet" />
      {list.data?.length === 0 && <p className="text-gray-400">No payments yet.</p>}
      <ul className="space-y-2">
        {list.data?.map((p) => (
          <li key={p.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {p.purpose === 'membership' ? `Membership: ${p.planName}` : 'Fines'} ·{' '}
                  {rupees(p.amount)}
                </p>
                <p className="text-sm text-gray-400">
                  {formatDate(p.paidAt ?? p.createdAt)} ·{' '}
                  {p.method === 'cash'
                    ? 'cash'
                    : p.method === 'counterUpi'
                      ? 'UPI at counter'
                      : 'online'}
                  {p.refund && ` · refunded ${rupees(p.refund.amount)}`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusPill tone={TONE[p.status]}>{p.status}</StatusPill>
                {p.receiptNo && (
                  <a
                    href={`/api/member/payments/${p.id}/receipt.pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-brand-500 hover:underline"
                  >
                    Receipt
                  </a>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
