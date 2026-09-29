import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIBRARY_STATUSES, type AdminLibraryDto, type LibraryStatus } from '@libraverse/shared';
import { Button, ErrorText } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';

type Action = 'approve' | 'reject' | 'suspend' | 'reactivate';

const ACTIONS: Record<LibraryStatus, Action[]> = {
  pending: ['approve', 'reject'],
  active: ['suspend'],
  suspended: ['reactivate'],
  rejected: [],
};

const ACTION_LABELS: Record<Action, string> = {
  approve: 'Approve',
  reject: 'Reject',
  suspend: 'Suspend',
  reactivate: 'Reactivate',
};

const STATUS_STYLES: Record<LibraryStatus, string> = {
  pending: 'bg-yellow-950 text-yellow-300',
  active: 'bg-emerald-950 text-emerald-300',
  suspended: 'bg-orange-950 text-orange-300',
  rejected: 'bg-gray-800 text-gray-400',
};

/** FR-05: approve, reject, suspend and reactivate libraries. Library-level facts only. */
export function AdminLibrariesPage() {
  const [status, setStatus] = useState<LibraryStatus>('pending');
  // Reject and suspend ask for a reason (emailed to the owner) before running.
  const [confirming, setConfirming] = useState<{ id: string; action: Action } | null>(null);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();
  const libraries = useQuery({
    queryKey: ['admin', 'libraries', status],
    queryFn: () => api<AdminLibraryDto[]>(`/api/admin/libraries?status=${status}`),
  });

  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: Action; reason?: string }) =>
      post(`/api/admin/libraries/${id}/${action}`, { reason }),
    onSuccess: () => {
      setConfirming(null);
      setReason('');
      return qc.invalidateQueries({ queryKey: ['admin', 'libraries'] });
    },
  });

  function run(lib: AdminLibraryDto, action: Action) {
    if (action === 'reject' || action === 'suspend') setConfirming({ id: lib.id, action });
    else act.mutate({ id: lib.id, action });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Libraries</h1>
      <div role="tablist" className="mt-4 flex flex-wrap gap-2">
        {LIBRARY_STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={s === status}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm capitalize ${s === status ? 'bg-brand-500 text-white' : 'border border-gray-700 text-gray-300'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <ErrorText>
          {act.error
            ? errorMessage(act.error)
            : libraries.error
              ? errorMessage(libraries.error)
              : ''}
        </ErrorText>
      </div>

      {libraries.isPending ? (
        <p className="mt-6 text-gray-400">Loading…</p>
      ) : libraries.data?.length === 0 ? (
        <p className="mt-6 text-gray-400">No {status} libraries.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {libraries.data?.map((lib) => (
            <li key={lib.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {lib.name}{' '}
                    <span
                      className={`ml-1 rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_STYLES[lib.status]}`}
                    >
                      {lib.status}
                    </span>
                  </p>
                  <p className="text-sm text-gray-400">
                    /{lib.slug} · {lib.planCode ?? 'no'} plan · registered{' '}
                    {new Date(lib.createdAt).toLocaleDateString()}
                  </p>
                  <p className="truncate text-sm text-gray-400">
                    {lib.ownerName} · {lib.contactEmail}
                  </p>
                  {lib.statusReason && (
                    <p className="mt-1 text-sm text-gray-500">Reason: {lib.statusReason}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {ACTIONS[lib.status].map((action) => (
                    <Button
                      key={action}
                      variant={
                        action === 'approve' || action === 'reactivate' ? 'primary' : 'danger'
                      }
                      busy={act.isPending && act.variables?.id === lib.id}
                      disabled={confirming?.id === lib.id}
                      onClick={() => run(lib, action)}
                    >
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                </div>
              </div>
              {confirming?.id === lib.id && (
                <form
                  className="mt-4 space-y-2 border-t border-gray-800 pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act.mutate({ ...confirming, reason: reason.trim() || undefined });
                  }}
                >
                  <label className="block text-sm text-gray-300">
                    Reason to {confirming.action} {lib.name} (emailed to the owner)
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={500}
                      rows={2}
                      className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100"
                    />
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" busy={act.isPending}>
                      Confirm {confirming.action}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
