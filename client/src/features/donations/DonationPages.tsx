import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchDto, PublicLibraryDto } from '@libraverse/shared';
import {
  AuthCard,
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

interface DonationDto {
  id: string;
  donorName: string;
  donorEmail: string;
  anonymous: boolean;
  isMember: boolean;
  title: string;
  author: string;
  condition: string;
  message: string;
  status: 'offered' | 'accepted' | 'declined' | 'catalogued';
  bookId: string | null;
  createdAt: string;
}

/** FR-03: anyone offers a book to a library. */
export function DonatePage() {
  const [params, setParams] = useSearchParams();
  const slug = params.get('library');
  const libs = useQuery({
    queryKey: ['public-libraries', ''],
    queryFn: () => api<PublicLibraryDto[]>('/api/public/libraries?q='),
    enabled: !slug,
  });
  const [f, setF] = useState({
    donorName: '',
    donorEmail: '',
    title: '',
    author: '',
    condition: 'good',
    message: '',
    anonymous: false,
  });
  const send = useMutation({
    mutationFn: () => post(`/api/public/libraries/${slug}/donations`, f),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  if (!slug) {
    return (
      <AuthCard title="Donate a book" subtitle="Choose the library you would like to give to.">
        <ul className="space-y-2">
          {libs.data?.map((l) => (
            <li key={l.slug}>
              <button
                type="button"
                onClick={() => setParams({ library: l.slug })}
                className="w-full rounded-lg border border-gray-700 px-4 py-3 text-left hover:border-brand-500"
              >
                {l.name}
              </button>
            </li>
          ))}
        </ul>
      </AuthCard>
    );
  }
  if (send.isSuccess) {
    return (
      <AuthCard title="Thank you!" subtitle="The library will review your offer and email you.">
        <Link to="/" className="text-brand-500 hover:underline">
          Back to home
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="Donate a book"
      subtitle="Tell the library about the book you would like to give."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
        className="space-y-3"
      >
        <Field label="Your name" required value={f.donorName} onChange={set('donorName')} />
        <Field
          label="Your email"
          type="email"
          required
          value={f.donorEmail}
          onChange={set('donorEmail')}
        />
        <Field label="Book title" required value={f.title} onChange={set('title')} />
        <Field label="Author" value={f.author} onChange={set('author')} />
        <SelectField label="Condition" value={f.condition} onChange={set('condition')}>
          {['new', 'good', 'fair', 'worn'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={f.anonymous}
            onChange={(e) => setF({ ...f, anonymous: e.target.checked })}
          />
          Donate anonymously (the book page will say “Donated by Anonymous”)
        </label>
        <ErrorText>{send.error ? errorMessage(send.error) : ''}</ErrorText>
        <Button type="submit" busy={send.isPending} className="w-full">
          Offer this book
        </Button>
      </form>
    </AuthCard>
  );
}

const TONE = {
  offered: 'yellow',
  accepted: 'green',
  declined: 'gray',
  catalogued: 'green',
} as const;

/** FR-18: librarians accept, decline and catalogue donations. */
export function DonationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<DonationDto['status']>('offered');
  const [cataloguing, setCataloguing] = useState<string | null>(null);
  const [cat, setCat] = useState({ category: 'General', count: '1', branchId: '', shelf: '' });
  const list = useQuery({
    queryKey: ['library', 'donations', status],
    queryFn: () => api<DonationDto[]>(`/api/donations?status=${status}`),
  });
  const branches = useQuery({
    queryKey: ['library', 'branches'],
    queryFn: () => api<BranchDto[]>('/api/branches'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['library', 'donations'] });
  const decide = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      post(`/api/donations/${id}/${accept ? 'accept' : 'decline'}`, {}),
    onSuccess: refresh,
  });
  const catalogue = useMutation({
    mutationFn: (id: string) =>
      post(`/api/donations/${id}/catalogue`, {
        category: cat.category,
        copies: {
          count: Number(cat.count),
          branchId: cat.branchId || branches.data?.[0]?.id,
          shelf: cat.shelf,
        },
      }),
    onSuccess: () => {
      setCataloguing(null);
      return refresh();
    },
  });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Donations" icon="gift" />
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {(['offered', 'accepted', 'catalogued', 'declined'] as const).map((s) => (
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
      <ErrorText>
        {decide.error
          ? errorMessage(decide.error)
          : catalogue.error
            ? errorMessage(catalogue.error)
            : ''}
      </ErrorText>
      {list.data?.length === 0 && <p className="text-gray-400">No {status} donations.</p>}
      <ul className="space-y-3">
        {list.data?.map((d) => (
          <li key={d.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {d.title}
                    {d.author && ` · ${d.author}`}{' '}
                    <StatusPill tone={TONE[d.status]}>{d.status}</StatusPill>
                  </p>
                  <p className="text-sm text-gray-400">
                    {d.anonymous ? 'Anonymous' : d.donorName} ({d.donorEmail})
                    {d.isMember && ' · member'} · {d.condition} · {formatDate(d.createdAt)}
                  </p>
                  {d.message && <p className="mt-1 text-sm text-gray-300">{d.message}</p>}
                </div>
                <div className="flex gap-2">
                  {d.status === 'offered' && (
                    <>
                      <Button onClick={() => decide.mutate({ id: d.id, accept: true })}>
                        Accept
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => decide.mutate({ id: d.id, accept: false })}
                      >
                        Decline
                      </Button>
                    </>
                  )}
                  {d.status === 'accepted' && (
                    <Button onClick={() => setCataloguing(d.id)}>Received: add to catalog</Button>
                  )}
                  {d.bookId && (
                    <Link
                      to={`/library/catalog/${d.bookId}`}
                      className="text-sm text-brand-500 hover:underline"
                    >
                      View book
                    </Link>
                  )}
                </div>
              </div>
              {cataloguing === d.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    catalogue.mutate(d.id);
                  }}
                  className="mt-4 grid gap-3 border-t border-gray-800 pt-4 sm:grid-cols-4"
                >
                  <Field
                    label="Category"
                    value={cat.category}
                    onChange={(e) => setCat({ ...cat, category: e.target.value })}
                  />
                  <Field
                    label="Copies"
                    type="number"
                    min="1"
                    max="20"
                    value={cat.count}
                    onChange={(e) => setCat({ ...cat, count: e.target.value })}
                  />
                  <SelectField
                    label="Branch"
                    value={cat.branchId}
                    onChange={(e) => setCat({ ...cat, branchId: e.target.value })}
                  >
                    {branches.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </SelectField>
                  <Field
                    label="Shelf"
                    value={cat.shelf}
                    onChange={(e) => setCat({ ...cat, shelf: e.target.value })}
                  />
                  <div className="sm:col-span-4">
                    <Button type="submit" busy={catalogue.isPending}>
                      Add to catalog
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
