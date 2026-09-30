import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardStatus, DueStatus, MemberRowDto, RefundMethod } from '@libraverse/shared';
import { Button, Card, ErrorText, Field, PageHeader, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';

const CARD_TONE: Record<CardStatus, 'green' | 'red' | 'yellow' | 'gray'> = {
  active: 'green',
  expired: 'red',
  blocked: 'red',
  none: 'gray',
  unverified: 'yellow',
};
const DUE_TEXT: Record<DueStatus, string> = {
  none: '',
  paid: 'Paid',
  pending: 'Due pending',
  deductionScheduled: 'Deduction scheduled',
  deducted: 'Deducted from deposit',
  blocked: 'Deposit exhausted',
};

/** Staff: every member with dues, deposit and card status (derived on the server). */
export function MembersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [refunding, setRefunding] = useState<MemberRowDto | null>(null);
  const refund = useMutation({
    mutationFn: ({ id, method }: { id: string; method: RefundMethod }) =>
      post<{ amount: number }>(`/api/deposit-refunds/${id}/refund`, { method }),
    onSuccess: () => {
      setRefunding(null);
      return qc.invalidateQueries({ queryKey: ['library'] });
    },
  });
  const list = useQuery({
    queryKey: ['library', 'members', q],
    queryFn: () => api<MemberRowDto[]>(`/api/members?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="max-w-6xl">
      <PageHeader title="Members" icon="users" />
      <Field
        label="Search"
        placeholder="Name or email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-2 pr-3">Member</th>
              <th className="pr-3">Plan</th>
              <th className="pr-3">Valid till</th>
              <th className="pr-3 text-right">Dues</th>
              <th className="pr-3 text-right">Deposit</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {list.data?.map((m) => (
              <tr key={m.profileId} className="align-middle">
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-3">
                    {m.hasPhoto ? (
                      <img
                        src={`/api/members/${m.profileId}/photo`}
                        alt=""
                        className="h-10 w-8 rounded object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="grid h-10 w-8 place-items-center rounded bg-gray-800 text-gray-400"
                      >
                        {m.name[0]}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {m.email}
                        {m.phone ? ` · ${m.phone}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="pr-3">{m.planName ?? '—'}</td>
                <td className="pr-3">{formatDate(m.validTill)}</td>
                <td className={`pr-3 text-right ${m.outstandingDues ? 'text-red-300' : ''}`}>
                  {rupees(m.outstandingDues)}
                </td>
                <td className="pr-3 text-right">{rupees(m.depositBalance)}</td>
                <td className="space-x-1">
                  <StatusPill tone={CARD_TONE[m.cardStatus]}>{m.cardStatus}</StatusPill>
                  {DUE_TEXT[m.dueStatus] && (
                    <StatusPill tone={m.dueStatus === 'paid' ? 'green' : 'yellow'}>
                      {DUE_TEXT[m.dueStatus]}
                    </StatusPill>
                  )}
                </td>
                <td className="pl-2 text-right">
                  {m.depositBalance > 0 && m.cardStatus !== 'none' && (
                    <button
                      type="button"
                      onClick={() => setRefunding(m)}
                      className="whitespace-nowrap text-xs text-brand-500 hover:underline"
                    >
                      Refund deposit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="mt-4 text-gray-400">No members found.</p>}
        {refunding && (
          <Card className="mt-4">
            <p className="font-medium">
              Refund {refunding.name}’s deposit and close the membership?
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Deposit {rupees(refunding.depositBalance)}
              {refunding.outstandingDues > 0 &&
                ` − unpaid dues ${rupees(refunding.outstandingDues)}`}{' '}
              = refund {rupees(Math.max(0, refunding.depositBalance - refunding.outstandingDues))}.
              Books on loan must be returned first.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                busy={refund.isPending}
                onClick={() => refund.mutate({ id: refunding.profileId, method: 'cash' })}
              >
                Refund in cash
              </Button>
              <Button
                variant="secondary"
                busy={refund.isPending}
                onClick={() => refund.mutate({ id: refunding.profileId, method: 'razorpay' })}
              >
                Refund via Razorpay
              </Button>
              <Button variant="secondary" onClick={() => setRefunding(null)}>
                Cancel
              </Button>
            </div>
            <ErrorText>{refund.error ? errorMessage(refund.error) : ''}</ErrorText>
          </Card>
        )}
      </div>
    </div>
  );
}
