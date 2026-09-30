import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchDto, StaffDto } from '@libraverse/shared';
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

const KEY = ['library', 'staff'] as const;

/** FR-09: add and remove librarians. */
export function StaffPage() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: KEY, queryFn: () => api<StaffDto[]>('/api/staff') });
  const branches = useQuery({
    queryKey: ['library', 'branches'],
    queryFn: () => api<BranchDto[]>('/api/branches'),
  });
  const [form, setForm] = useState({ name: '', email: '', branchId: '' });

  const add = useMutation({
    mutationFn: () => post<StaffDto>('/api/staff', { ...form, branchId: form.branchId || null }),
    onSuccess: () => {
      setForm({ name: '', email: '', branchId: '' });
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/staff/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const branchName = (id: string | null) => branches.data?.find((b) => b.id === id)?.name;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Staff" icon="userCog" />
      <ul className="space-y-2">
        {staff.data?.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-800 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {s.name}{' '}
                <StatusPill
                  tone={
                    s.status === 'active' ? 'green' : s.status === 'invited' ? 'yellow' : 'gray'
                  }
                >
                  {s.status}
                </StatusPill>
              </p>
              <p className="truncate text-sm text-gray-400">
                {s.email} · {s.role === 'libraryAdmin' ? 'Library admin' : 'Librarian'}
                {branchName(s.branchId) ? ` · ${branchName(s.branchId)}` : ''}
              </p>
            </div>
            {s.role === 'librarian' && s.status !== 'disabled' && (
              <Button
                variant="danger"
                busy={remove.isPending && remove.variables === s.id}
                onClick={() => remove.mutate(s.id)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <ErrorText>{remove.error ? errorMessage(remove.error) : ''}</ErrorText>
      </div>
      <Card className="mt-6">
        <h2 className="font-medium">Add a librarian</h2>
        <p className="text-sm text-gray-400">
          They get an email with a link to set their password.
        </p>
        <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label="Email"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <SelectField
            label="Branch"
            value={form.branchId}
            onChange={(e) => setForm({ ...form, branchId: e.target.value })}
          >
            <option value="">Any branch</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </SelectField>
          <div className="self-end">
            <Button type="submit" busy={add.isPending}>
              Add librarian
            </Button>
          </div>
          <div className="sm:col-span-2">
            <ErrorText>{add.error ? errorMessage(add.error) : ''}</ErrorText>
          </div>
        </form>
      </Card>
    </div>
  );
}
