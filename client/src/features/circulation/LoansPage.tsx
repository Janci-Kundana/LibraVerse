import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoanDto, ReservationDto, ReservationStatus } from '@libraverse/shared';
import { Button, ErrorText, Field, PageHeader } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { LoanSummary } from './LoanRow';

const TABS = ['active', 'overdue', 'returned', 'lost'] as const;

export function LoansPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]>('active');
  const [q, setQ] = useState('');
  const qc = useQueryClient();
  const loans = useQuery({
    queryKey: ['library', 'loans', status, q],
    queryFn: () =>
      api<LoanDto[]>(`/api/circulation/loans?status=${status}&q=${encodeURIComponent(q)}`),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'renew' | 'lost' }) =>
      post(`/api/circulation/loans/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library', 'loans'] }),
  });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Loans" icon="repeat" />
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === status}
            onClick={() => setStatus(t)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${t === status ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_6px_20px_-8px_rgb(226_41_74/0.9)]' : 'border border-white/10 text-gray-300 hover:border-white/25 hover:text-white'}`}
          >
            {t}
          </button>
        ))}
      </div>
      <Field
        label="Search member"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Name or email"
      />
      <div className="mt-3">
        <ErrorText>{act.error ? errorMessage(act.error) : ''}</ErrorText>
      </div>
      {loans.data?.length === 0 && <p className="mt-4 text-gray-400">No {status} loans.</p>}
      <ul className="mt-3 divide-y divide-white/[0.06]">
        {loans.data?.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <LoanSummary loan={l} showMember />
            {l.status === 'active' && (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => act.mutate({ id: l.id, action: 'renew' })}
                >
                  Renew
                </Button>
                <Button variant="danger" onClick={() => act.mutate({ id: l.id, action: 'lost' })}>
                  Mark lost
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const RES_TABS: ReservationStatus[] = ['waiting', 'ready', 'fulfilled', 'expired', 'cancelled'];

export function ReservationsPage() {
  const [status, setStatus] = useState<ReservationStatus>('waiting');
  const list = useQuery({
    queryKey: ['library', 'reservations', status],
    queryFn: () => api<ReservationDto[]>(`/api/circulation/reservations?status=${status}`),
  });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Reservations" icon="bookmark" />
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {RES_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === status}
            onClick={() => setStatus(t)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${t === status ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_6px_20px_-8px_rgb(226_41_74/0.9)]' : 'border border-white/10 text-gray-300 hover:border-white/25 hover:text-white'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {list.data?.length === 0 && <p className="text-gray-400">No {status} reservations.</p>}
      <ul className="divide-y divide-white/[0.06]">
        {list.data?.map((r) => (
          <li key={r.id} className="py-3">
            <p className="font-medium">{r.bookTitle}</p>
            <p className="text-sm text-gray-400">
              {r.memberName}
              {r.position ? ` · #${r.position} in queue` : ''}
              {r.status === 'ready' &&
                ` · hold copy ${r.copyCode} until ${formatDate(r.holdUntil)}`}
              {' · '}reserved {formatDate(r.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
