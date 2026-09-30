import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  SelectField,
  StatusPill,
} from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface EventDto {
  id: string;
  kind: 'event' | 'announcement';
  title: string;
  date: string | null;
  description: string;
  createdAt: string;
}

function EventList({ list, onDelete }: { list: EventDto[]; onDelete?: (id: string) => void }) {
  return (
    <ul className="space-y-3">
      {list.map((e) => (
        <li key={e.id}>
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {e.title}{' '}
                  <StatusPill tone={e.kind === 'event' ? 'green' : 'yellow'}>{e.kind}</StatusPill>
                </p>
                <p className="text-sm text-gray-400">
                  {e.kind === 'event' ? formatDate(e.date) : `Posted ${formatDate(e.createdAt)}`}
                </p>
                {e.description && (
                  <p className="mt-2 whitespace-pre-line text-sm text-gray-300">{e.description}</p>
                )}
              </div>
              {onDelete && (
                <Button variant="danger" onClick={() => onDelete(e.id)}>
                  Delete
                </Button>
              )}
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function StaffEventsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['library', 'events'],
    queryFn: () => api<EventDto[]>('/api/events'),
  });
  const [f, setF] = useState({
    kind: 'announcement',
    title: '',
    date: '',
    description: '',
    notifyMembers: true,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['library', 'events'] });
  const add = useMutation({
    mutationFn: () =>
      post('/api/events', { ...f, date: f.kind === 'event' && f.date ? f.date : null }),
    onSuccess: () => {
      setF({ ...f, title: '', date: '', description: '' });
      return refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/events/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Events & notices" />
      <Card className="mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          <SelectField
            label="Type"
            value={f.kind}
            onChange={(e) => setF({ ...f, kind: e.target.value })}
          >
            <option value="announcement">Announcement</option>
            <option value="event">Event</option>
          </SelectField>
          {f.kind === 'event' ? (
            <Field
              label="Date"
              type="datetime-local"
              required
              value={f.date}
              onChange={(e) => setF({ ...f, date: e.target.value })}
            />
          ) : (
            <div />
          )}
          <div className="sm:col-span-2">
            <Field
              label="Title"
              required
              value={f.title}
              onChange={(e) => setF({ ...f, title: e.target.value })}
            />
          </div>
          <label className="block sm:col-span-2">
            <span className="text-sm text-gray-300">Details</span>
            <textarea
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
              rows={3}
              className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={f.notifyMembers}
              onChange={(e) => setF({ ...f, notifyMembers: e.target.checked })}
            />{' '}
            Notify all members
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" busy={add.isPending}>
              Post
            </Button>{' '}
            <ErrorText>{add.error ? errorMessage(add.error) : ''}</ErrorText>
          </div>
        </form>
      </Card>
      <EventList list={list.data ?? []} onDelete={(id) => remove.mutate(id)} />
    </div>
  );
}

export function MemberEventsPage() {
  const list = useQuery({
    queryKey: ['member', 'events'],
    queryFn: () => api<EventDto[]>('/api/member/events'),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notice board" />
      {list.data?.length === 0 && <p className="text-gray-400">Nothing on the board right now.</p>}
      <EventList list={list.data ?? []} />
    </div>
  );
}
