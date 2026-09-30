import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DueStatus, MemberProfileDto, MemberStandingDto } from '@libraverse/shared';
import { Button, Card, ErrorText, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate, readFileAsDataUrl, rupees } from '../../lib/format';
import { DepositRefundCard } from './DepositRefund';

const DUE_LABEL: Record<DueStatus, { text: string; tone: 'green' | 'yellow' | 'red' | 'gray' }> = {
  none: { text: 'No dues', tone: 'green' },
  paid: { text: 'Dues paid', tone: 'green' },
  deducted: { text: 'Deducted from deposit', tone: 'yellow' },
  pending: { text: 'Due pending', tone: 'yellow' },
  deductionScheduled: { text: 'Deposit deduction scheduled', tone: 'red' },
  blocked: { text: 'Card blocked', tone: 'red' },
};

/** Deposit balance, unpaid dues, the reminder cycle and the deposit history. */
export function StandingPanel() {
  const s = useQuery({
    queryKey: ['member', 'standing'],
    queryFn: () => api<MemberStandingDto>('/api/member/standing'),
  });
  if (!s.data) return null;
  const d = s.data;
  const label = DUE_LABEL[d.dueStatus];
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Deposit and dues</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs uppercase tracking-wide text-gray-500">Security deposit</p>
          <p className="mt-1 text-2xl font-semibold">{rupees(d.depositBalance)}</p>
          <p className="text-xs text-gray-500">Library amount {rupees(d.depositAmount)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-gray-500">Unpaid dues</p>
          <p className={`mt-1 text-2xl font-semibold ${d.outstandingDues ? 'text-red-300' : ''}`}>
            {rupees(d.outstandingDues)}
          </p>
          <StatusPill tone={label.tone}>{label.text}</StatusPill>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-gray-500">Card</p>
          <p className="mt-1 text-2xl font-semibold capitalize">{d.cardStatus}</p>
          {d.dueStatus === 'pending' && (
            <p className="text-xs text-gray-400">Reminder {d.warningsSent} of 3 sent</p>
          )}
          {d.deductionScheduledFor && (
            <p className="text-xs text-red-300">
              Deduction on {formatDate(d.deductionScheduledFor)}
            </p>
          )}
        </Card>
      </div>
      {d.dueStatus === 'blocked' && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          Your deposit is used up and {rupees(d.outstandingDues)} is still owed, so your card is
          blocked. Pay it on My books to unblock it.
        </p>
      )}
      <DepositRefundCard />
      {d.history.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-gray-300">Deposit history</summary>
          <ul className="mt-2 divide-y divide-gray-800">
            {d.history.map((t) => (
              <li key={t.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {formatDate(t.createdAt)} ·{' '}
                  {t.type === 'collected'
                    ? 'Deposit paid'
                    : t.type === 'refund'
                      ? 'Deposit refunded'
                      : 'Deducted for dues'}
                  {t.dueBefore != null && (
                    <span className="text-gray-500">
                      {' '}
                      (due {rupees(t.dueBefore)} → {rupees(t.dueAfter ?? 0)})
                    </span>
                  )}
                </span>
                <span className={t.type === 'collected' ? 'text-emerald-300' : 'text-red-300'}>
                  {t.type === 'collected' ? '+' : '−'}
                  {rupees(t.amount)} · balance {rupees(t.balanceAfter)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * The card photo. Before the ID is approved it can be replaced directly; after
 * that a new photo is a request that staff approve (the card keeps the current
 * one until then).
 */
export function PhotoUploader({ profile }: { profile: MemberProfileDto }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const approved = profile.verificationStatus === 'approved';
  const change = profile.photoChange;
  const upload = useMutation({
    mutationFn: async () =>
      post<MemberProfileDto>('/api/member/photo', { photo: await readFileAsDataUrl(file!) }),
    onSuccess: () => {
      setFile(null);
      setPreview(null);
      // Profile, and the card (on Home and My card) once a photo is live.
      return qc.invalidateQueries({ queryKey: ['member'] });
    },
  });
  return (
    <Card className="mt-4 max-w-xl">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          <img
            src={`/api/member/photo?v=${profile.id}-${String(profile.hasPhoto)}`}
            alt="Current card photo"
            className="h-20 w-16 rounded-lg bg-gray-800 object-cover"
            onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
          />
          {(preview || change?.status === 'pending') && (
            <img
              src={preview ?? `/api/member/photo/pending?v=${change?.requestedAt ?? ''}`}
              alt="New photo"
              className="h-20 w-16 rounded-lg bg-gray-800 object-cover ring-2 ring-amber-300/60"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Card photo</p>
          <p className="text-sm text-gray-400">
            {approved
              ? 'Shown on your card and to staff when they scan it. A new photo needs staff approval.'
              : 'Shown on your card and to staff when they scan it.'}
          </p>
          {change?.status === 'pending' && (
            <p className="mt-2">
              <StatusPill tone="yellow">New photo waiting for staff approval</StatusPill>
            </p>
          )}
          {change?.status === 'rejected' && (
            <p className="mt-2 text-sm text-red-300">
              Your new photo was not approved: {change.note ?? 'no reason given'}. You can upload
              another.
            </p>
          )}
          <input
            type="file"
            aria-label="Card photo"
            accept="image/jpeg,image/png,image/webp"
            className="mt-2 text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
        </div>
        <Button disabled={!file} busy={upload.isPending} onClick={() => upload.mutate()}>
          {approved ? 'Send for approval' : 'Save photo'}
        </Button>
      </div>
      <ErrorText>{upload.error ? errorMessage(upload.error) : ''}</ErrorText>
    </Card>
  );
}
