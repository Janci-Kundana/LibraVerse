import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { LoanDto, MemberScanDto, ReturnResultDto } from '@libraverse/shared';
import { QrScanner } from '../../components/QrScanner';
import { Button, Card, ErrorText, Field, PageHeader, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, rupees, toPaise } from '../../lib/format';
import { CollectPayment } from '../payments/StaffPayments';
import { LoanSummary } from './LoanRow';

type Tab = 'issue' | 'return';

/** The counter: issue by two scans (FR-15) and returns with automatic fines (FR-16). */
export function CounterPage() {
  const [tab, setTab] = useState<Tab>('issue');
  return (
    <div className="max-w-3xl">
      <PageHeader title="Counter" icon="scan" />
      <div role="tablist" className="mb-6 flex gap-2">
        {(['issue', 'return'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm capitalize ${tab === t ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_6px_20px_-8px_rgb(226_41_74/0.9)]' : 'border border-white/10 text-gray-300 hover:border-white/25 hover:text-white'}`}
          >
            {t === 'issue' ? 'Issue' : 'Return'}
          </button>
        ))}
      </div>
      {tab === 'issue' ? <IssuePanel /> : <ReturnPanel />}
    </div>
  );
}

const CARD_TONE = {
  active: 'green',
  expired: 'red',
  blocked: 'red',
  none: 'yellow',
  unverified: 'yellow',
} as const;
const CARD_LABEL = {
  active: 'Active',
  expired: 'Expired',
  blocked: 'Blocked',
  none: 'No plan',
  unverified: 'ID not verified',
} as const;
const DUE_LABEL = {
  none: '',
  paid: '',
  pending: 'Due pending',
  deductionScheduled: 'Deposit deduction scheduled',
  deducted: 'Deducted from deposit',
  blocked: 'Deposit exhausted',
} as const;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="truncate text-gray-200">{children}</dd>
    </div>
  );
}

function IssuePanel() {
  const [token, setToken] = useState<string | null>(null);
  const [issued, setIssued] = useState<LoanDto[]>([]);
  const scan = useMutation({
    mutationFn: (memberToken: string) =>
      post<MemberScanDto>('/api/circulation/scan-member', { memberToken }),
  });
  const issue = useMutation({
    mutationFn: (copyCode: string) =>
      post<LoanDto>('/api/circulation/issue', { memberToken: token, copyCode }),
    onSuccess: (loan) => {
      setIssued((l) => [loan, ...l]);
      if (token) scan.mutate(token);
    },
  });

  function scanMember(code: string) {
    setToken(code);
    setIssued([]);
    issue.reset();
    scan.mutate(code);
  }

  const m = scan.data;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium">1. Scan the member’s card</h2>
        <div className="mt-3">
          <QrScanner label="Member card code" onScan={scanMember} />
        </div>
        <div className="mt-3">
          <ErrorText>{scan.error ? errorMessage(scan.error) : ''}</ErrorText>
        </div>
      </Card>

      {m && (
        <Card>
          <div className="flex flex-wrap items-start gap-4">
            {m.photoUrl ? (
              <img
                src={m.photoUrl}
                alt={`Photo of ${m.name}`}
                className="h-28 w-24 rounded-lg object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="grid h-28 w-24 place-items-center rounded-lg bg-gray-800 text-3xl font-semibold text-gray-400"
              >
                {m.name.trim()[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-medium">{m.name}</p>
                <StatusPill tone={CARD_TONE[m.cardStatus]}>{CARD_LABEL[m.cardStatus]}</StatusPill>
                {m.dueStatus !== 'none' && m.dueStatus !== 'paid' && (
                  <StatusPill
                    tone={
                      m.dueStatus === 'blocked' || m.dueStatus === 'deductionScheduled'
                        ? 'red'
                        : 'yellow'
                    }
                  >
                    {DUE_LABEL[m.dueStatus]}
                  </StatusPill>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <Detail label="Card no.">
                  {m.membershipNo ? m.membershipNo.replace(/(\d{4})(?=\d)/g, '$1 ') : '—'}
                </Detail>
                <Detail label="Contact">{m.phone ?? '—'}</Detail>
                <Detail label="Library">{m.libraryName}</Detail>
                <Detail label="Plan">{m.planName ?? 'No plan'}</Detail>
                <Detail label="Card issued">{formatDate(m.cardIssuedAt)}</Detail>
                <Detail label="Valid till">{formatDate(m.validTill)}</Detail>
                <Detail label="Dues">{rupees(m.pendingDues)}</Detail>
                <Detail label="Deposit">{rupees(m.depositBalance)}</Detail>
                <Detail label="Books">
                  {m.activeLoans.length} of {m.bookLimit}
                </Detail>
              </dl>
            </div>
          </div>
          {m.blockedReason ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200"
            >
              Cannot issue: {m.blockedReason}
            </p>
          ) : (
            <p className="mt-3 text-sm text-emerald-400">
              Can borrow {m.bookLimit - m.activeLoans.length} more.
            </p>
          )}
          {m.readyReservations.length > 0 && (
            <p className="mt-2 text-sm text-yellow-300">
              Waiting for them:{' '}
              {m.readyReservations.map((r) => `${r.bookTitle} (${r.copyCode})`).join(', ')}
            </p>
          )}
          {m.activeLoans.length > 0 && (
            <ul className="mt-3 space-y-2 border-t border-gray-800 pt-3">
              {m.activeLoans.map((l) => (
                <li key={l.id}>
                  <LoanSummary loan={l} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {m && token && m.membershipStatus !== 'unverified' && (
        <CollectPayment
          key={token}
          member={m}
          memberToken={token}
          onPaid={() => scan.mutate(token)}
        />
      )}

      {m?.canBorrow && (
        <Card>
          <h2 className="font-medium">2. Scan the book’s QR</h2>
          <div className="mt-3">
            <QrScanner
              label="Book copy code"
              onScan={(code) => issue.mutate(code)}
              disabled={issue.isPending}
            />
          </div>
          <div className="mt-3">
            <ErrorText>{issue.error ? errorMessage(issue.error) : ''}</ErrorText>
          </div>
        </Card>
      )}

      {issued.map((l) => (
        <p
          key={l.id}
          role="status"
          className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
        >
          Issued “{l.bookTitle}” to {l.memberName}, due {formatDate(l.dueAt)}.
        </p>
      ))}
    </div>
  );
}

interface CopyStatus {
  copyCode: string;
  bookTitle: string;
  status: string;
  activeLoan: LoanDto | null;
}

function ReturnPanel() {
  const [condition, setCondition] = useState<'ok' | 'damaged'>('ok');
  const [charge, setCharge] = useState('');
  const [note, setNote] = useState('');
  const lookup = useMutation({
    mutationFn: (code: string) =>
      api<CopyStatus>(`/api/circulation/copies/${encodeURIComponent(code)}`),
  });
  const ret = useMutation({
    mutationFn: () =>
      post<ReturnResultDto>('/api/circulation/return', {
        copyCode: lookup.data!.copyCode,
        condition,
        ...(condition === 'damaged'
          ? { damageCharge: toPaise(charge || '0'), note: note || undefined }
          : {}),
      }),
  });

  function onScan(code: string) {
    ret.reset();
    setCondition('ok');
    setCharge('');
    setNote('');
    lookup.mutate(code);
  }

  const loan = lookup.data?.activeLoan;
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="font-medium">Scan the returned book</h2>
        <div className="mt-3">
          <QrScanner label="Book copy code" onScan={onScan} />
        </div>
        <div className="mt-3">
          <ErrorText>{lookup.error ? errorMessage(lookup.error) : ''}</ErrorText>
        </div>
      </Card>

      {lookup.data && !loan && !ret.data && (
        <Card>
          <p className="text-sm text-gray-300">
            “{lookup.data.bookTitle}” is not on loan (status: {lookup.data.status}).
          </p>
        </Card>
      )}

      {loan && !ret.data && (
        <Card>
          <LoanSummary loan={loan} showMember />
          <p className="mt-3 text-sm">
            {loan.overdueDays > 0
              ? `Returned ${loan.overdueDays} day${loan.overdueDays > 1 ? 's' : ''} late: fine ${rupees(loan.fineAmount)}.`
              : 'On time: no fine.'}
          </p>
          <fieldset className="mt-3 flex gap-4 text-sm">
            <legend className="sr-only">Condition</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={condition === 'ok'}
                onChange={() => setCondition('ok')}
              />{' '}
              Good condition
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={condition === 'damaged'}
                onChange={() => setCondition('damaged')}
              />{' '}
              Damaged
            </label>
          </fieldset>
          {condition === 'damaged' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Damage charge (₹)"
                type="number"
                min="0"
                step="0.01"
                value={charge}
                onChange={(e) => setCharge(e.target.value)}
              />
              <Field label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          <div className="mt-3">
            <ErrorText>{ret.error ? errorMessage(ret.error) : ''}</ErrorText>
          </div>
          <Button className="mt-3" busy={ret.isPending} onClick={() => ret.mutate()}>
            Confirm return
          </Button>
        </Card>
      )}

      {ret.data && (
        <p
          role="status"
          className="rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
        >
          Returned “{ret.data.loan.bookTitle}”.
          {ret.data.loan.fineAmount + ret.data.loan.damageCharge > 0 &&
            ` ${rupees(ret.data.loan.fineAmount + ret.data.loan.damageCharge)} added to ${ret.data.loan.memberName}'s dues.`}
          {ret.data.heldFor && ` Put it aside: it is reserved for ${ret.data.heldFor}.`}
        </p>
      )}
    </div>
  );
}
