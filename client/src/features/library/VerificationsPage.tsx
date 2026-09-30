import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VerificationItemDto, VerificationStatus } from '@libraverse/shared';
import { Button, Card, ErrorText, PageHeader } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate } from '../../lib/format';

const STATUSES: VerificationStatus[] = ['pending', 'approved', 'rejected'];

/** FR-13: librarians approve or reject members' ID proofs. */
export function VerificationsPage() {
  const [status, setStatus] = useState<VerificationStatus>('pending');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ['library', 'verifications', status],
    queryFn: () => api<VerificationItemDto[]>(`/api/verifications?status=${status}`),
  });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      post(`/api/verifications/${id}/${decision}`, decision === 'reject' ? { reason } : {}),
    onSuccess: () => {
      setRejecting(null);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['library', 'verifications'] });
    },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader title="ID verification" icon="shieldCheck" />
      <div role="tablist" className="mb-4 flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={s === status}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${s === status ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_6px_20px_-8px_rgb(226_41_74/0.9)]' : 'border border-white/10 text-gray-300 hover:border-white/25 hover:text-white'}`}
          >
            {s}
          </button>
        ))}
      </div>
      <ErrorText>{decide.error ? errorMessage(decide.error) : ''}</ErrorText>
      {items.data?.length === 0 && <p className="text-gray-400">Nothing {status}.</p>}
      <ul className="space-y-3">
        {items.data?.map((m) => (
          <li key={m.profileId}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{m.name}</p>
                  <p className="truncate text-sm text-gray-400">
                    {m.email}
                    {m.phone ? ` · ${m.phone}` : ''} · submitted {formatDate(m.submittedAt)}
                  </p>
                  {m.note && <p className="text-sm text-gray-500">Reason: {m.note}</p>}
                  <a
                    href={`/api/verifications/${m.profileId}/id-proof`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-brand-500 hover:underline"
                  >
                    View ID proof
                  </a>
                </div>
                {m.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button
                      busy={decide.isPending && decide.variables?.id === m.profileId}
                      onClick={() => decide.mutate({ id: m.profileId, decision: 'approve' })}
                    >
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => setRejecting(m.profileId)}>
                      Reject
                    </Button>
                  </div>
                )}
              </div>
              {rejecting === m.profileId && (
                <form
                  className="mt-4 space-y-2 border-t border-gray-800 pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    decide.mutate({ id: m.profileId, decision: 'reject' });
                  }}
                >
                  <label className="block text-sm text-gray-300">
                    Reason (emailed to the member)
                    <textarea
                      required
                      minLength={3}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      className="mt-1 block w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 outline-none transition focus:border-brand-400/70 focus:ring-4 focus:ring-brand-500/15"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" busy={decide.isPending}>
                      Confirm reject
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
