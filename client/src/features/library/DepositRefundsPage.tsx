import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepositRefundRequestDto, RefundMethod } from '@libraverse/shared';
import { Button, Card, ErrorText, PageHeader } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';

const KEY = ['library', 'deposit-refunds'] as const;

/** Staff: approve deposit refunds (cash or Razorpay) or reject them. */
export function DepositRefundsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: KEY,
    queryFn: () => api<DepositRefundRequestDto[]>('/api/deposit-refunds'),
  });
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const done = () => {
    setRejecting(null);
    setReason('');
    return qc.invalidateQueries({ queryKey: ['library'] });
  };
  const approve = useMutation({
    mutationFn: ({ id, method }: { id: string; method: RefundMethod }) =>
      post(`/api/deposit-refunds/${id}/approve`, { method }),
    onSuccess: done,
  });
  const reject = useMutation({
    mutationFn: (id: string) => post(`/api/deposit-refunds/${id}/reject`, { reason }),
    onSuccess: done,
  });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Deposit refunds" />
      <p className="mb-4 text-sm text-gray-400">
        Unpaid dues are taken from the deposit first; only the rest is refunded. Approving closes
        the member’s membership.
      </p>
      <ErrorText>
        {approve.error
          ? errorMessage(approve.error)
          : reject.error
            ? errorMessage(reject.error)
            : ''}
      </ErrorText>
      {list.data?.length === 0 && <p className="text-gray-400">No refund requests.</p>}
      <ul className="space-y-3">
        {list.data?.map((r) => {
          const busy = approve.isPending && approve.variables?.id === r.profileId;
          return (
            <li key={r.profileId}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-sm text-gray-400">
                      {r.email} · requested {formatDate(r.requestedAt)}
                    </p>
                    {r.reason && <p className="mt-1 text-sm text-gray-300">“{r.reason}”</p>}
                    <p className="mt-2 text-sm">
                      Deposit {rupees(r.depositBalance)}
                      {r.outstandingDues > 0 && <> − dues {rupees(r.outstandingDues)}</>} ={' '}
                      <strong>refund {rupees(r.refundable)}</strong>
                    </p>
                    {r.activeLoans > 0 && (
                      <p className="text-sm text-yellow-300">
                        {r.activeLoans} book(s) still out: collect them first.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      busy={busy}
                      disabled={r.activeLoans > 0}
                      onClick={() => approve.mutate({ id: r.profileId, method: 'cash' })}
                    >
                      Refund {rupees(r.refundable)} in cash
                    </Button>
                    <Button
                      variant="secondary"
                      busy={busy}
                      disabled={r.activeLoans > 0 || r.razorpayRefundable < r.refundable}
                      title={
                        r.razorpayRefundable < r.refundable
                          ? 'This deposit was not paid online in full'
                          : undefined
                      }
                      onClick={() => approve.mutate({ id: r.profileId, method: 'razorpay' })}
                    >
                      Refund via Razorpay
                    </Button>
                    <Button variant="danger" onClick={() => setRejecting(r.profileId)}>
                      Reject
                    </Button>
                  </div>
                </div>
                {rejecting === r.profileId && (
                  <form
                    className="mt-3 flex flex-wrap gap-2 border-t border-gray-800 pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      reject.mutate(r.profileId);
                    }}
                  >
                    <label className="min-w-0 flex-1 text-sm text-gray-300">
                      Reason (sent to the member)
                      <input
                        required
                        minLength={3}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
                      />
                    </label>
                    <div className="self-end">
                      <Button type="submit" variant="danger" busy={reject.isPending}>
                        Confirm reject
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
