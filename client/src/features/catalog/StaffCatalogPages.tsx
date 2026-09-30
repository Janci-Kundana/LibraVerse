import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookDetailDto,
  BookDto,
  BranchDto,
  CopyDto,
  CsvImportResultDto,
  Paged,
} from '@libraverse/shared';
import { BookCover } from '../../components/BookCover';
import {
  PageSkeleton,
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  SelectField,
  StatusPill,
} from '../../components/ui';
import { api, errorMessage, post, put } from '../../lib/api';
import { BookForm, type BookFormValues } from './BookForm';

const BOOKS_KEY = ['library', 'books'] as const;

function useBranches() {
  return useQuery({
    queryKey: ['library', 'branches'],
    queryFn: () => api<BranchDto[]>('/api/branches'),
  });
}

export function StaffCatalogPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const books = useQuery({
    queryKey: [...BOOKS_KEY, q, page],
    queryFn: () => api<Paged<BookDto>>(`/api/books?q=${encodeURIComponent(q)}&page=${page}`),
    placeholderData: keepPreviousData,
  });
  const pages = books.data ? Math.max(1, Math.ceil(books.data.total / books.data.pageSize)) : 1;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Catalog">
        <div className="flex gap-2">
          <Link
            to="/library/catalog/import"
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
          >
            Import CSV
          </Link>
          <Link
            to="/library/catalog/new"
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Add book
          </Link>
        </div>
      </PageHeader>
      <Field
        label="Search"
        placeholder="Title, author or ISBN"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
      />
      <p className="mt-3 text-sm text-gray-500">{books.data?.total ?? 0} titles</p>
      <ul className="mt-2 divide-y divide-gray-800">
        {books.data?.items.map((b) => (
          <li key={b.id}>
            <Link
              to={`/library/catalog/${b.id}`}
              className="flex items-center gap-4 py-3 hover:bg-gray-900"
            >
              <BookCover url={b.coverUrl} title={b.title} className="h-16 w-12" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{b.title}</p>
                <p className="truncate text-sm text-gray-400">
                  {b.authors.join(', ') || 'Unknown author'} · {b.category}
                </p>
              </div>
              <span className="text-sm text-gray-300">
                {b.copies.available}/{b.copies.total} on shelf
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

export function NewBookPage() {
  const branches = useBranches();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (v: BookFormValues) => post<BookDetailDto>('/api/books', v),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: BOOKS_KEY });
      navigate(`/library/catalog/${book.id}`);
    },
  });
  if (!branches.data) return <PageSkeleton />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Add a book" />
      <Card>
        <BookForm
          branches={branches.data}
          busy={create.isPending}
          error={create.error}
          onSubmit={(v) => create.mutate(v)}
        />
      </Card>
    </div>
  );
}

const COPY_TONE = {
  available: 'green',
  issued: 'yellow',
  reserved: 'yellow',
  lost: 'red',
  damaged: 'red',
} as const;

export function StaffBookPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = [...BOOKS_KEY, 'detail', id];
  const book = useQuery({ queryKey: key, queryFn: () => api<BookDetailDto>(`/api/books/${id}`) });
  const branches = useBranches();
  const [editing, setEditing] = useState(false);
  const [add, setAdd] = useState({ count: '1', branchId: '', shelf: '' });

  const refresh = (data?: BookDetailDto) => {
    if (data) qc.setQueryData(key, data);
    return qc.invalidateQueries({ queryKey: BOOKS_KEY });
  };
  const save = useMutation({
    mutationFn: (v: BookFormValues) => put<BookDetailDto>(`/api/books/${id}`, v),
    onSuccess: (d) => {
      setEditing(false);
      return refresh(d);
    },
  });
  const addCopies = useMutation({
    mutationFn: () =>
      post<BookDetailDto>(`/api/books/${id}/copies`, {
        count: Number(add.count),
        branchId: add.branchId || branches.data?.[0]?.id,
        shelf: add.shelf,
      }),
    onSuccess: (d) => refresh(d),
  });
  const updateCopy = useMutation({
    mutationFn: ({ copy, status }: { copy: CopyDto; status: string }) =>
      put(`/api/copies/${copy.id}`, { status }),
    onSuccess: () => refresh(),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/api/books/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void refresh();
      navigate('/library/catalog');
    },
  });

  if (book.isError) return <ErrorText>{errorMessage(book.error)}</ErrorText>;
  if (!book.data) return <PageSkeleton />;
  const b = book.data;

  return (
    <div className="max-w-5xl">
      <PageHeader title={b.title}>
        <div className="flex gap-2">
          <a
            href={`/api/books/stickers.pdf?bookId=${b.id}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm hover:bg-gray-800"
          >
            Print QR stickers
          </a>
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
            Delete
          </Button>
        </div>
      </PageHeader>
      <ErrorText>{remove.error ? errorMessage(remove.error) : ''}</ErrorText>

      {editing ? (
        <Card>
          <BookForm
            initial={b}
            busy={save.isPending}
            error={save.error}
            onSubmit={(v) => save.mutate(v)}
          />
        </Card>
      ) : (
        <div className="flex gap-5">
          <BookCover url={b.coverUrl} title={b.title} className="h-48 w-36" />
          <div className="text-sm text-gray-300">
            <p>{b.authors.join(', ') || 'Unknown author'}</p>
            <p className="text-gray-400">
              {b.category} · {b.language}
              {b.publishedYear ? ` · ${b.publishedYear}` : ''}
              {b.isbn ? ` · ISBN ${b.isbn}` : ''}
            </p>
            {b.donatedBy && <p className="mt-1 text-gray-400">Donated by {b.donatedBy}</p>}
            <p className="mt-3 max-w-prose text-gray-400">{b.description}</p>
          </div>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">
        Copies ({b.copies.available} of {b.copies.total} on shelf)
      </h2>
      <ErrorText>{updateCopy.error ? errorMessage(updateCopy.error) : ''}</ErrorText>
      <ul className="mt-3 divide-y divide-gray-800 rounded-lg border border-gray-800">
        {b.copyList.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <a
              href={`/api/copies/${c.id}/qr.png`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-brand-500 hover:underline"
            >
              {c.qrCode}
            </a>
            <span className="text-gray-400">
              {c.branchName}
              {c.shelf ? ` · shelf ${c.shelf}` : ''}
            </span>
            <StatusPill tone={COPY_TONE[c.status]}>{c.status}</StatusPill>
            {!['issued', 'reserved'].includes(c.status) && (
              <select
                aria-label={`Status of ${c.qrCode}`}
                value={c.status}
                onChange={(e) => updateCopy.mutate({ copy: c, status: e.target.value })}
                className="ml-auto rounded border border-gray-700 bg-gray-950 px-2 py-1"
              >
                <option value="available">available</option>
                <option value="damaged">damaged</option>
                <option value="lost">lost</option>
              </select>
            )}
          </li>
        ))}
      </ul>

      <Card className="mt-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            addCopies.mutate();
          }}
          className="grid gap-3 sm:grid-cols-4"
        >
          <Field
            label="Add copies"
            type="number"
            min="1"
            max="200"
            value={add.count}
            onChange={(e) => setAdd({ ...add, count: e.target.value })}
          />
          <SelectField
            label="Branch"
            value={add.branchId}
            onChange={(e) => setAdd({ ...add, branchId: e.target.value })}
          >
            {branches.data?.map((br) => (
              <option key={br.id} value={br.id}>
                {br.name}
              </option>
            ))}
          </SelectField>
          <Field
            label="Shelf"
            value={add.shelf}
            onChange={(e) => setAdd({ ...add, shelf: e.target.value })}
          />
          <div className="self-end">
            <Button type="submit" busy={addCopies.isPending}>
              Add
            </Button>
          </div>
        </form>
        <ErrorText>{addCopies.error ? errorMessage(addCopies.error) : ''}</ErrorText>
      </Card>
    </div>
  );
}

const SAMPLE =
  'title,authors,isbn,category,language,publishedYear,copies,shelf,branch\nDune,Frank Herbert,9780441172719,Science fiction,English,1965,2,A-3,\n';

export function ImportBooksPage() {
  const [csv, setCsv] = useState('');
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => post<CsvImportResultDto>('/api/books/import', { csv }),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOOKS_KEY }),
  });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Import books from CSV" />
      <p className="text-sm text-gray-400">
        Columns: <code>title</code> (required), <code>authors</code> (separate with ;),{' '}
        <code>isbn</code>, <code>category</code>, <code>language</code>, <code>publishedYear</code>,{' '}
        <code>copies</code>, <code>shelf</code>, <code>branch</code> (name; blank = first branch). A
        known ISBN adds copies to that book.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="CSV file"
        className="mt-4 text-sm"
        onChange={async (e) => setCsv((await e.target.files?.[0]?.text()) ?? '')}
      />
      <label className="mt-4 block">
        <span className="text-sm text-gray-300">CSV</span>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={10}
          placeholder={SAMPLE}
          className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs"
        />
      </label>
      <Button
        className="mt-3"
        disabled={!csv.trim()}
        busy={run.isPending}
        onClick={() => run.mutate()}
      >
        Import
      </Button>
      <div className="mt-3">
        <ErrorText>{run.error ? errorMessage(run.error) : ''}</ErrorText>
      </div>
      {run.data && (
        <Card className="mt-4">
          <p role="status">
            Added {run.data.created} new title{run.data.created === 1 ? '' : 's'} and{' '}
            {run.data.copiesCreated} cop{run.data.copiesCreated === 1 ? 'y' : 'ies'}.
          </p>
          {run.data.errors.length > 0 && (
            <ul className="mt-2 text-sm text-red-300">
              {run.data.errors.map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
