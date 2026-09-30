import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CounterRequestDto,
  MembershipPlanDto,
  MemberScanDto,
  PaymentDto,
  PaymentSettingsDto,
  PublicPayDto,
} from '@libraverse/shared';
import {
  PageSkeleton,
  AuthCard,
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  SelectField,
  StatusPill,
} from '../../components/ui';
import { api, errorMessage, post, put } from '../../lib/api';
import { formatDate, rupees, toPaise } from '../../lib/format';
import { openCheckout } from '../../lib/razorpay';
import { useMe } from '../auth/useAuth';
import { mmss, useCountdown, usePaymentStatus } from './usePaymentStatus';

const TONE = {
  success: 'green',
  created: 'yellow',
  pending: 'yellow',
  failed: 'red',
  expired: 'gray',
} as const;

/**
 * FR-17 at the counter, shown after a member's card is scanned: collect a plan
 * or their fines by cash, or by UPI QR that updates live.
 */
export function CollectPayment({
  member,
  memberToken,
  onPaid,
}: {
  member: MemberScanDto;
  memberToken: string;
  onPaid: () => void;
}) {
  const plans = useQuery({
    queryKey: ['library', 'membership-plans'],
    queryFn: () => api<MembershipPlanDto[]>('/api/membership-plans'),
  });
  const [what, setWhat] = useState(member.pendingDues > 0 ? 'fine' : '');
  const [request, setRequest] = useState<CounterRequestDto | null>(null);
  const collect = useMutation({
    mutationFn: (method: 'cash' | 'counterUpi') =>
      post<CounterRequestDto>('/api/payments/counter', {
        memberToken,
        method,
        ...(what === 'fine' ? { purpose: 'fine' } : { purpose: 'membership', planId: what }),
      }),
    onSuccess: (r) => {
      setRequest(r);
      if (r.payment.status === 'success') onPaid();
    },
  });

  if (request?.payQrDataUrl) {
    return <CounterQr request={request} onPaid={onPaid} onClose={() => setRequest(null)} />;
  }
  return (
    <Card>
      <h2 className="font-medium">Collect payment</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <SelectField label="For" value={what} onChange={(e) => setWhat(e.target.value)}>
          <option value="">Choose…</option>
          {member.pendingDues > 0 && (
            <option value="fine">Fines: {rupees(member.pendingDues)}</option>
          )}
          {plans.data
            ?.filter((p) => p.active)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}: {rupees(p.price)}
              </option>
            ))}
        </SelectField>
        <Button
          disabled={!what}
          busy={collect.isPending}
          onClick={() => collect.mutate('counterUpi')}
        >
          UPI QR
        </Button>
        <Button
          variant="secondary"
          disabled={!what}
          busy={collect.isPending}
          onClick={() => collect.mutate('cash')}
        >
          Cash received
        </Button>
      </div>
      <div className="mt-3">
        <ErrorText>{collect.error ? errorMessage(collect.error) : ''}</ErrorText>
      </div>
      {request?.payment.status === 'success' && (
        <p role="status" className="mt-3 text-sm text-emerald-300">
          Payment Successful: {rupees(request.payment.amount)} in cash, receipt{' '}
          {request.payment.receiptNo}.
        </p>
      )}
    </Card>
  );
}

function CounterQr({
  request,
  onPaid,
  onClose,
}: {
  request: CounterRequestDto;
  onPaid: () => void;
  onClose: () => void;
}) {
  const [status] = usePaymentStatus(
    request.payment.id,
    request.payment.status,
    `/api/payments/${request.payment.id}/verify`,
  );
  const left = useCountdown(request.payment.expiresAt);
  if (status === 'success') {
    return (
      <Card>
        <p role="status" className="text-xl font-semibold text-emerald-300">
          Payment Successful
        </p>
        <p className="text-sm text-gray-300">
          {rupees(request.payment.amount)} from {request.payment.memberName}.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            onPaid();
            onClose();
          }}
        >
          Done
        </Button>
      </Card>
    );
  }
  const over = status === 'failed' || status === 'expired' || left === 0;
  return (
    <Card className="text-center">
      <p className="font-medium">Ask the member to scan and pay {rupees(request.payment.amount)}</p>
      <img
        src={request.payQrDataUrl!}
        alt="Payment QR code"
        className={`mx-auto mt-3 w-56 rounded-lg bg-white p-2 ${over ? 'opacity-30' : ''}`}
      />
      <p className="mt-2 text-sm text-gray-400">
        {over ? (
          status === 'failed' ? (
            'Payment failed.'
          ) : (
            'This QR has expired.'
          )
        ) : (
          <>
            Waiting… <span className="font-mono">{mmss(left)}</span>
          </>
        )}
      </p>
      <Button className="mt-3" variant="secondary" onClick={onClose}>
        {over ? 'New request' : 'Cancel'}
      </Button>
    </Card>
  );
}

/** FR-11: payments with receipts; admins can refund. */
export function PaymentsPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [refunding, setRefunding] = useState<PaymentDto | null>(null);
  const [refund, setRefund] = useState({ amount: '', reason: '' });
  const list = useQuery({
    queryKey: ['library', 'payments', status],
    queryFn: () => api<PaymentDto[]>(`/api/payments${status ? `?status=${status}` : ''}`),
  });
  const doRefund = useMutation({
    mutationFn: () =>
      post(`/api/payments/${refunding!.id}/refund`, {
        reason: refund.reason,
        ...(refund.amount ? { amount: toPaise(refund.amount) } : {}),
      }),
    onSuccess: () => {
      setRefunding(null);
      setRefund({ amount: '', reason: '' });
      return qc.invalidateQueries({ queryKey: ['library', 'payments'] });
    },
  });
  const collected = (list.data ?? [])
    .filter((p) => p.status === 'success')
    .reduce((s, p) => s + p.amount - (p.refund?.amount ?? 0), 0);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Payments">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {Object.keys(TONE).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </SelectField>
      </PageHeader>
      <p className="mb-3 text-sm text-gray-400">Net collected in this list: {rupees(collected)}</p>
      <ul className="divide-y divide-gray-800">
        {list.data?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {p.memberName} · {rupees(p.amount)} ·{' '}
                {p.purpose === 'membership' ? p.planName : 'fines'}
              </p>
              <p className="text-sm text-gray-400">
                {formatDate(p.paidAt ?? p.createdAt)} · {p.method}
                {p.collectedByName && ` · collected by ${p.collectedByName}`}
                {p.receiptNo && ` · ${p.receiptNo}`}
                {p.refund && ` · refunded ${rupees(p.refund.amount)} (${p.refund.reason})`}
                {p.lateCaptureRefunded && ' · late payment auto-refunded'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone={TONE[p.status]}>{p.status}</StatusPill>
              {p.receiptNo && (
                <a
                  className="text-sm text-brand-500 hover:underline"
                  href={`/api/payments/${p.id}/receipt.pdf`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Receipt
                </a>
              )}
              {me?.role === 'libraryAdmin' && p.status === 'success' && !p.refund && (
                <Button variant="danger" onClick={() => setRefunding(p)}>
                  Refund
                </Button>
              )}
            </div>
            {refunding?.id === p.id && (
              <form
                className="grid w-full gap-2 sm:grid-cols-[1fr_2fr_auto]"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  doRefund.mutate();
                }}
              >
                <Field
                  label="Amount (₹, blank = full)"
                  type="number"
                  step="0.01"
                  value={refund.amount}
                  onChange={(e) => setRefund({ ...refund, amount: e.target.value })}
                />
                <Field
                  label="Reason"
                  required
                  minLength={3}
                  value={refund.reason}
                  onChange={(e) => setRefund({ ...refund, reason: e.target.value })}
                />
                <div className="self-end">
                  <Button type="submit" variant="danger" busy={doRefund.isPending}>
                    Confirm refund
                  </Button>
                </div>
                <div className="sm:col-span-3">
                  <ErrorText>{doRefund.error ? errorMessage(doRefund.error) : ''}</ErrorText>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** FR-08: connect the library's own Razorpay account (test mode). */
export function PaymentSettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['library', 'payment-settings'],
    queryFn: () => api<PaymentSettingsDto>('/api/library/payment-settings'),
  });
  const [f, setF] = useState({ keyId: '', keySecret: '', webhookSecret: '' });
  const save = useMutation({
    mutationFn: () =>
      put<PaymentSettingsDto>('/api/library/payment-settings', {
        keyId: f.keyId || settings.data?.keyId,
        ...(f.keySecret ? { keySecret: f.keySecret } : {}),
        ...(f.webhookSecret ? { webhookSecret: f.webhookSecret } : {}),
      }),
    onSuccess: (d) => {
      qc.setQueryData(['library', 'payment-settings'], d);
      setF({ keyId: '', keySecret: '', webhookSecret: '' });
    },
  });
  const s = settings.data;
  if (!s) return <PageSkeleton />;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Online payments" />
      <Card>
        <p className="text-sm text-gray-400">
          Member payments go straight to your own Razorpay account. Use your{' '}
          <strong>test mode</strong> keys from Razorpay Dashboard → Settings → API Keys. Secrets are
          encrypted and never shown again.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="mt-4 space-y-3"
        >
          <Field
            label="Key id"
            placeholder={s.keyId ?? 'rzp_test_…'}
            value={f.keyId}
            onChange={(e) => setF({ ...f, keyId: e.target.value })}
          />
          <Field
            label="Key secret"
            type="password"
            autoComplete="off"
            placeholder={s.keySecretSet ? '•••••••• (saved)' : ''}
            value={f.keySecret}
            onChange={(e) => setF({ ...f, keySecret: e.target.value })}
          />
          <Field
            label="Webhook secret"
            type="password"
            autoComplete="off"
            placeholder={s.webhookSecretSet ? '•••••••• (saved)' : ''}
            value={f.webhookSecret}
            onChange={(e) => setF({ ...f, webhookSecret: e.target.value })}
          />
          <div className="rounded-lg bg-gray-950 p-3 text-sm">
            <p className="text-gray-300">
              In Razorpay → Settings → Webhooks, add this URL with the same webhook secret and the
              events <code>payment.captured</code> and <code>payment.failed</code>:
            </p>
            <p className="mt-1 break-all font-mono text-xs text-brand-500">{s.webhookUrl}</p>
          </div>
          <ErrorText>{save.error ? errorMessage(save.error) : ''}</ErrorText>
          <Button type="submit" busy={save.isPending}>
            Save
          </Button>
          {save.isSuccess && <span className="ml-3 text-sm text-emerald-400">Saved</span>}
        </form>
      </Card>
    </div>
  );
}

/** /pay/:token, reached by scanning the counter QR. Same Razorpay Checkout. */
export function PublicPayPage() {
  const { token } = useParams();
  const info = useQuery({
    queryKey: ['pay', token],
    // The server checks with Razorpay on every refresh (no webhook needed).
    queryFn: () => post<PublicPayDto>(`/api/pay/${token}/verify`),
    refetchInterval: 5000,
  });
  const left = useCountdown(info.data?.expiresAt ?? null);
  const pay = useMutation({
    mutationFn: async () => {
      const d = info.data!;
      await post(`/api/pay/${token}/opened`).catch(() => {});
      await openCheckout({
        key: d.keyId!,
        order_id: d.orderId!,
        amount: d.amount,
        name: d.libraryName,
        description: d.description,
        timeout: Math.max(60, left),
        handler: () => void info.refetch(),
      });
    },
  });
  if (info.isError)
    return <AuthCard title="Payment not found">{errorMessage(info.error)}</AuthCard>;
  if (!info.data) return <AuthCard title="Loading…">{null}</AuthCard>;
  const d = info.data;
  const open = (d.status === 'created' || d.status === 'pending') && left > 0;
  return (
    <AuthCard title={d.libraryName} subtitle={d.description}>
      <p className="text-3xl font-semibold">{rupees(d.amount)}</p>
      {d.status === 'success' ? (
        <p role="status" className="mt-4 text-lg text-emerald-400">
          Paid. Thank you!
        </p>
      ) : open ? (
        <>
          <p className="mt-2 text-sm text-gray-400">
            Time left: <span className="font-mono">{mmss(left)}</span>
          </p>
          <Button className="mt-4 w-full" busy={pay.isPending} onClick={() => pay.mutate()}>
            Pay with UPI / card
          </Button>
          <ErrorText>{pay.error ? errorMessage(pay.error) : ''}</ErrorText>
        </>
      ) : (
        <p role="alert" className="mt-4 text-red-300">
          This payment request has {d.status === 'failed' ? 'failed' : 'expired'}. Ask at the
          counter for a new one.
        </p>
      )}
    </AuthCard>
  );
}
