import { useState, type FormEvent } from 'react';
import type { BookDetailDto, BranchDto, IsbnLookupDto } from '@libraverse/shared';
import { BookCover } from '../../components/BookCover';
import { Button, ErrorText, Field, SelectField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { readFileAsDataUrl } from '../../lib/format';

export interface BookFormValues {
  title: string;
  authors: string[];
  isbn: string | null;
  category: string;
  language: string;
  description: string;
  publishedYear: number | null;
  cover?: string | null;
  copies?: { count: number; branchId: string; shelf: string };
}

/** Add or edit a book. New books can look up their details by ISBN (Open Library). */
export function BookForm({
  initial,
  branches,
  busy,
  error,
  onSubmit,
}: {
  initial?: BookDetailDto;
  branches?: BranchDto[];
  busy: boolean;
  error: unknown;
  onSubmit: (values: BookFormValues) => void;
}) {
  const [f, setF] = useState({
    title: initial?.title ?? '',
    authors: initial?.authors.join(', ') ?? '',
    isbn: initial?.isbn ?? '',
    category: initial?.category ?? 'General',
    language: initial?.language ?? 'English',
    description: initial?.description ?? '',
    publishedYear: initial?.publishedYear ? String(initial.publishedYear) : '',
    copies: '1',
    branchId: branches?.[0]?.id ?? '',
    shelf: '',
  });
  const [coverUrl, setCoverUrl] = useState<string | null>(initial?.coverUrl ?? null);
  const [coverChanged, setCoverChanged] = useState(false);
  const [lookup, setLookup] = useState<{ busy: boolean; error: string }>({
    busy: false,
    error: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  async function autofill() {
    setLookup({ busy: true, error: '' });
    try {
      const r = await api<IsbnLookupDto>(`/api/books/isbn/${encodeURIComponent(f.isbn)}`);
      setF((cur) => ({
        ...cur,
        isbn: r.isbn,
        title: r.title,
        authors: r.authors.join(', '),
        category: r.category ?? cur.category,
        publishedYear: r.publishedYear ? String(r.publishedYear) : cur.publishedYear,
        description: r.description || cur.description,
      }));
      if (r.coverUrl) {
        setCoverUrl(r.coverUrl);
        setCoverChanged(true);
      }
      setLookup({ busy: false, error: '' });
    } catch (err) {
      setLookup({ busy: false, error: errorMessage(err) });
    }
  }

  async function onCoverFile(file: File | undefined) {
    if (!file) return;
    setCoverUrl(await readFileAsDataUrl(file));
    setCoverChanged(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      title: f.title,
      authors: f.authors
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      isbn: f.isbn.trim() || null,
      category: f.category,
      language: f.language,
      description: f.description,
      publishedYear: f.publishedYear ? Number(f.publishedYear) : null,
      ...(coverChanged ? { cover: coverUrl } : {}),
      ...(!initial && Number(f.copies) > 0 && f.branchId
        ? { copies: { count: Number(f.copies), branchId: f.branchId, shelf: f.shelf } }
        : {}),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[auto_1fr]">
      <div className="space-y-2">
        <BookCover url={coverUrl} title={f.title || '?'} className="h-48 w-36" />
        <input
          type="file"
          aria-label="Cover image"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void onCoverFile(e.target.files?.[0])}
          className="w-36 text-xs"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-end gap-2 sm:col-span-2">
          <div className="flex-1">
            <Field label="ISBN" value={f.isbn} onChange={set('isbn')} placeholder="978…" />
          </div>
          {!initial && (
            <Button
              type="button"
              variant="secondary"
              busy={lookup.busy}
              disabled={!f.isbn.trim()}
              onClick={() => void autofill()}
            >
              Auto-fill
            </Button>
          )}
        </div>
        {lookup.error && (
          <div className="sm:col-span-2">
            <ErrorText>{lookup.error}</ErrorText>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Title" required value={f.title} onChange={set('title')} />
        </div>
        <Field
          label="Authors"
          hint="Separate with commas"
          value={f.authors}
          onChange={set('authors')}
        />
        <Field
          label="Published year"
          type="number"
          value={f.publishedYear}
          onChange={set('publishedYear')}
        />
        <Field label="Category" required value={f.category} onChange={set('category')} />
        <Field label="Language" required value={f.language} onChange={set('language')} />
        <label className="block sm:col-span-2">
          <span className="text-sm text-gray-300">Description</span>
          <textarea
            value={f.description}
            onChange={set('description')}
            rows={3}
            className="mt-1 block w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 outline-none transition focus:border-brand-400/70 focus:ring-4 focus:ring-brand-500/15"
          />
        </label>
        {!initial && (
          <>
            <Field
              label="Copies"
              type="number"
              min="0"
              max="200"
              value={f.copies}
              onChange={set('copies')}
            />
            <SelectField label="Branch" value={f.branchId} onChange={set('branchId')}>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <Field label="Shelf" value={f.shelf} onChange={set('shelf')} placeholder="e.g. A-3" />
          </>
        )}
        <div className="sm:col-span-2">
          <ErrorText>{error ? errorMessage(error) : ''}</ErrorText>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" busy={busy}>
            {initial ? 'Save book' : 'Add book'}
          </Button>
        </div>
      </div>
    </form>
  );
}
