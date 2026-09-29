import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberCardDto, MemberLoansDto } from '@libraverse/shared';
import { Button, Card, ErrorText, PageHeader, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';
import { LoanSummary } from './LoanRow';

export const MEMBER_LOANS_KEY = ['member', 'loans'] as const;

const STATUS_TONE = { active: 'green', expired: 'red', blocked: 'red' } as const;

/** A flat card with the signed QR; Phase 6 replaces it with the 3D card. */
export function CardPage() {
  const card = useQuery({
    queryKey: ['member', 'card'],
    queryFn: () => api<MemberCardDto>('/api/member/card'),
  });
  if (card.isError) return <ErrorText>{errorMessage(card.error)}</ErrorText>;
  if (!card.data) return <p className="text-gray-400">Loading…</p>;
  const c = card.data;
  return (
    <div className="max-w-md">
      <PageHeader title="My card" />
      <div className="rounded-2xl bg-gradient-to-br from-brand-900 to-gray-900 p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="font-semibold">{c.libraryName}</p>
          <StatusPill tone={STATUS_TONE[c.status]}>{c.status}</StatusPill>
        </div>
        <p className="mt-6 font-mono text-lg tracking-widest">
          {c.membershipNo.replace(/(\d{4})(?=\d)/g, '$1 ')}
        </p>
        <p className="mt-1 text-sm text-gray-300">
          {c.name} · {c.tier} · valid thru {formatDate(c.validTill)}
        </p>
        <img
          src={c.qrDataUrl}
          alt="Membership QR code"
          className="mx-auto mt-5 w-48 rounded-lg bg-white p-2"
        />
        <p className="mt-2 text-center text-xs text-gray-400">
          Show this at the counter to borrow books
        </p>
      </div>
    </div>
  );
}

export function MyLoansPage() {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: MEMBER_LOANS_KEY,
    queryFn: () => api<MemberLoansDto>('/api/member/loans'),
  });
  const renew = useMutation({
    mutationFn: (id: string) => post(`/api/member/loans/${id}/renew`),
    onSuccess: () => qc.invalidateQueries({ queryKey: MEMBER_LOANS_KEY }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api<void>(`/api/member/reservations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MEMBER_LOANS_KEY }),
  });
  if (!data.data) return <p className="text-gray-400">Loading…</p>;
  const d = data.data;

  return (
    <div className="max-w-3xl">
      <PageHeader title="My books" />
      {d.pendingDues > 0 && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          You owe {rupees(d.pendingDues)} in fines. Pay it to keep borrowing.
        </p>
      )}
      <ErrorText>
        {renew.error ? errorMessage(renew.error) : cancel.error ? errorMessage(cancel.error) : ''}
      </ErrorText>

      <h2 className="mt-2 text-lg font-semibold">Borrowed</h2>
      {d.current.length === 0 && (
        <p className="text-sm text-gray-400">Nothing borrowed right now.</p>
      )}
      <div className="mt-2 space-y-2">
        {d.current.map((l) => (
          <Card key={l.id} className="flex flex-wrap items-center justify-between gap-3">
            <LoanSummary loan={l} />
            <Button
              variant="secondary"
              busy={renew.isPending && renew.variables === l.id}
              onClick={() => renew.mutate(l.id)}
            >
              Renew
            </Button>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Reservations</h2>
      {d.reservations.length === 0 && <p className="text-sm text-gray-400">No reservations.</p>}
      <div className="mt-2 space-y-2">
        {d.reservations.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{r.bookTitle}</p>
              <p className="text-sm text-gray-400">
                {r.status === 'ready'
                  ? `Ready to collect until ${formatDate(r.holdUntil)}`
                  : `#${r.position} in the queue`}
              </p>
            </div>
            <Button variant="secondary" onClick={() => cancel.mutate(r.id)}>
              Cancel
            </Button>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">History</h2>
      <ul className="mt-2 divide-y divide-gray-800">
        {d.history.map((l) => (
          <li key={l.id} className="py-2">
            <LoanSummary loan={l} />
          </li>
        ))}
      </ul>
    </div>
  );
}
