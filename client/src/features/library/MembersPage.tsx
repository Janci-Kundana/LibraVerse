import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CardStatus, DueStatus, MemberRowDto } from '@libraverse/shared';
import { Field, PageHeader, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
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
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['library', 'members', q],
    queryFn: () => api<MemberRowDto[]>(`/api/members?q=${encodeURIComponent(q)}`),
  });
  return (
    <div className="max-w-6xl">
      <PageHeader title="Members" />
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
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
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <p className="mt-4 text-gray-400">No members found.</p>}
      </div>
    </div>
  );
}
