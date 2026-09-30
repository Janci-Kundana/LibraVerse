import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, post } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { getSocket } from '../../lib/socket';

interface Inbox {
  unread: number;
  items: { id: string; title: string; message: string; read: boolean; createdAt: string }[];
}

const KEY = ['notifications'];

/** In-app notification centre (FR-24), live over Socket.io. */
export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: KEY,
    queryFn: () => api<Inbox>('/api/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => post('/api/notifications/read', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  useEffect(() => {
    const socket = getSocket();
    const onNew = () => void qc.invalidateQueries({ queryKey: KEY });
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [qc]);

  const unread = inbox.data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen(!open)}
        className="relative rounded-full p-1.5 text-gray-300 hover:bg-gray-800"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-800 bg-gray-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
            <p className="text-sm font-medium">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => readAll.mutate()}
                className="text-xs text-brand-500"
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {inbox.data?.items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-gray-500">
                You are all caught up.
              </li>
            )}
            {inbox.data?.items.map((n) => (
              <li
                key={n.id}
                className={`border-b border-gray-800 px-4 py-3 text-sm ${n.read ? 'text-gray-400' : ''}`}
              >
                <p className="font-medium">{n.title}</p>
                <p className="line-clamp-3 text-gray-400">{n.message}</p>
                <p className="mt-1 text-xs text-gray-600">{formatDate(n.createdAt)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
