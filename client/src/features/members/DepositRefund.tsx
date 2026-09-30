import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepositRefundDto } from '@libraverse/shared';
import { Button, Card, ErrorText } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';

const KEY = ['member', 'deposit-refund'] as const;

/** Member: ask for the security deposit back when leaving the library. */
export function DepositRefundCard() {
  const qc = useQueryClient();
  const r = useQuery({
    queryKey: KEY,
    queryFn: () => api<DepositRefundDto>('/api/member/deposit-refund'),
  });
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const refresh = (d: DepositRefundDto) => {
    qc.setQueryData(KEY, d);
    setConfirming(false);
    return qc.invalidateQueries({ queryKey: ['member'] });
  };
  const request = useMutation({
    mutationFn: () =>
      post<DepositRefundDto>('/api/member/deposit-refund', { reason: reason.trim() || undefined }),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => api<DepositRefundDto>('/api/member/deposit-refund', { method: 'DELETE' }),
    onSuccess: refresh,
  });
  if (!r.data) return null;
  const d = r.data;

  return (
    <Card className="mt-3">
      <h3 className="font-medium">Deposit refund</h3>
      {d.status === 'requested' ? (
        <>
          <p className="mt-1 text-sm text-gray-300">
            Requested on {formatDate(d.requestedAt)}. Expected refund:{' '}
            <strong>{rupees(d.amount)}</strong>
            {d.outstandingDues > 0 && ` (after ${rupees(d.outstandingDues)} of unpaid dues)`}. The
            library will contact you.
          </p>
          <Button
            className="mt-3"
            variant="secondary"
            busy={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            Cancel request
          </Button>
        </>
      ) : d.status === 'completed' ? (
        <p className="mt-1 text-sm text-gray-300">
          {d.amount > 0
            ? `${rupees(d.amount)} refunded ${d.method === 'cash' ? 'in cash' : 'to your original payment'} on ${formatDate(d.decidedAt)}.`
            : `Closed on ${formatDate(d.decidedAt)}: there was nothing left in your deposit to refund.`}{' '}
          Your membership is closed; buy a plan to rejoin.
        </p>
      ) : (
        <>
          {d.status === 'rejected' && (
            <p className="mt-1 text-sm text-yellow-300">
              Your last request was not approved{d.note ? `: ${d.note}` : ''}.
            </p>
          )}
          {d.blockedReason ? (
            <p className="mt-1 text-sm text-gray-400">{d.blockedReason}.</p>
          ) : confirming ? (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-gray-300">
                You will get back <strong>{rupees(d.amount)}</strong>
                {d.outstandingDues > 0 &&
                  ` (your deposit ${rupees(d.depositBalance)} minus unpaid dues ${rupees(d.outstandingDues)})`}
                . Once the library approves it, <strong>your membership closes</strong> and your
                card stops working.
              </p>
              <label className="block text-sm text-gray-300">
                Reason (optional)
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={300}
                  className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
                />
              </label>
              <div className="flex gap-2">
                <Button variant="danger" busy={request.isPending} onClick={() => request.mutate()}>
                  Request refund and close membership
                </Button>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Keep my membership
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-gray-400">
                Leaving the library? You can get back {rupees(d.amount)} of your deposit.
              </p>
              <Button className="mt-3" variant="secondary" onClick={() => setConfirming(true)}>
                Request deposit refund
              </Button>
            </>
          )}
        </>
      )}
      <ErrorText>
        {request.error
          ? errorMessage(request.error)
          : cancel.error
            ? errorMessage(cancel.error)
            : ''}
      </ErrorText>
    </Card>
  );
}
