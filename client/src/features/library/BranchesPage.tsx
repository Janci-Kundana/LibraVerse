import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchDto } from '@libraverse/shared';
import { Button, Card, ErrorText, Field, PageHeader } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';

const KEY = ['library', 'branches'] as const;

export function BranchesPage() {
  const qc = useQueryClient();
  const branches = useQuery({ queryKey: KEY, queryFn: () => api<BranchDto[]>('/api/branches') });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');

  const add = useMutation({
    mutationFn: () => post<BranchDto>('/api/branches', { name, address }),
    onSuccess: () => {
      setName('');
      setAddress('');
      return qc.invalidateQueries({ queryKey: KEY });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/branches/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Branches" icon="mapPin" />
      <ul className="space-y-2">
        {branches.data?.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 px-4 py-3"
          >
            <div>
              <p className="font-medium">{b.name}</p>
              {b.address && <p className="text-sm text-gray-400">{b.address}</p>}
            </div>
            <Button
              variant="danger"
              busy={remove.isPending && remove.variables === b.id}
              onClick={() => remove.mutate(b.id)}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <ErrorText>{remove.error ? errorMessage(remove.error) : ''}</ErrorText>
      </div>
      <Card className="mt-6">
        <h2 className="font-medium">Add a branch</h2>
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          <Field
            label="Branch name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <ErrorText>{add.error ? errorMessage(add.error) : ''}</ErrorText>
          <Button type="submit" busy={add.isPending}>
            Add branch
          </Button>
        </form>
      </Card>
    </div>
  );
}
