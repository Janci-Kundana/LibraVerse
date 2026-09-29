import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogBookDetailDto,
  CatalogBookDto,
  CatalogFacetsDto,
  Paged,
  ReservationDto,
} from '@libraverse/shared';
import { BookCover, Stars } from '../../components/BookCover';
import { Button, Card, ErrorText, PageHeader, SelectField } from '../../components/ui';
import { api, errorMessage, post, put } from '../../lib/api';
import { formatDate } from '../../lib/format';

const CATALOG_KEY = ['member', 'catalog'] as const;

const SORT_LABELS = {
  new: 'New arrivals',
  popular: 'Popular',
  rating: 'Top rated',
  title: 'Title A–Z',
} as const;

function useWishlistToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      api<void>(`/api/member/catalog/wishlist/${id}`, { method: on ? 'PUT' : 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CATALOG_KEY }),
  });
}

export function BookCard({ book, action }: { book: CatalogBookDto; action?: ReactNode }) {
  return (
    <Card className="flex gap-3">
      <Link to={`/member/books/${book.id}`} className="shrink-0">
        <BookCover url={book.coverUrl} title={book.title} className="h-28 w-20" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link to={`/member/books/${book.id}`} className="line-clamp-2 font-medium hover:underline">
          {book.title}
        </Link>
        <p className="truncate text-sm text-gray-400">
          {book.authors.join(', ') || 'Unknown author'}
        </p>
        <Stars value={book.ratingAvg} />
        <p
          className={`text-sm ${book.copies.available > 0 ? 'text-emerald-400' : 'text-gray-500'}`}
        >
          {book.copies.available > 0 ? `${book.copies.available} available` : 'All copies out'}
        </p>
        {action}
      </div>
    </Card>
  );
}

export function MemberCatalogPage() {
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({
    category: '',
    language: '',
    available: false,
    sort: 'new' as keyof typeof SORT_LABELS,
  });
  const [page, setPage] = useState(1);
  const facets = useQuery({
    queryKey: [...CATALOG_KEY, 'facets'],
    queryFn: () => api<CatalogFacetsDto>('/api/member/catalog/facets'),
  });
  const params = new URLSearchParams({
    q,
    sort: filters.sort,
    page: String(page),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.available ? { available: 'true' } : {}),
  });
  const books = useQuery({
    queryKey: [...CATALOG_KEY, 'search', params.toString()],
    queryFn: () => api<Paged<CatalogBookDto>>(`/api/member/catalog/books?${params}`),
    placeholderData: keepPreviousData,
  });
  const toggle = useWishlistToggle();
  const pages = books.data ? Math.max(1, Math.ceil(books.data.total / books.data.pageSize)) : 1;
  const setFilter = (patch: Partial<typeof filters>) => {
    setFilters({ ...filters, ...patch });
    setPage(1);
  };

  return (
    <div className="max-w-6xl">
      <PageHeader title="Catalog" />
      <form onSubmit={(e: FormEvent) => e.preventDefault()} className="grid gap-3 md:grid-cols-5">
        <label className="md:col-span-2">
          <span className="text-sm text-gray-300">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Title, author or ISBN"
            className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
          />
        </label>
        <SelectField
          label="Category"
          value={filters.category}
          onChange={(e) => setFilter({ category: e.target.value })}
        >
          <option value="">All</option>
          {facets.data?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField
          label="Language"
          value={filters.language}
          onChange={(e) => setFilter({ language: e.target.value })}
        >
          <option value="">All</option>
          {facets.data?.languages.map((l) => (
            <option key={l}>{l}</option>
          ))}
        </SelectField>
        <SelectField
          label="Sort"
          value={filters.sort}
          onChange={(e) => setFilter({ sort: e.target.value as keyof typeof SORT_LABELS })}
        >
          {Object.entries(SORT_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </SelectField>
      </form>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-300">
        <input
          type="checkbox"
          checked={filters.available}
          onChange={(e) => setFilter({ available: e.target.checked })}
        />
        Available now
      </label>

      <p className="mt-4 text-sm text-gray-500">{books.data?.total ?? 0} books</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {books.data?.items.map((b) => (
          <BookCard
            key={b.id}
            book={b}
            action={
              <button
                type="button"
                onClick={() => toggle.mutate({ id: b.id, on: !b.inWishlist })}
                className="mt-1 text-sm text-brand-500 hover:underline"
                aria-pressed={b.inWishlist}
              >
                {b.inWishlist ? '♥ In wishlist' : '♡ Add to wishlist'}
              </button>
            }
          />
        ))}
      </div>
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

export function MemberBookPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const key = [...CATALOG_KEY, 'book', id];
  const book = useQuery({
    queryKey: key,
    queryFn: () => api<CatalogBookDetailDto>(`/api/member/catalog/books/${id}`),
  });
  const toggle = useWishlistToggle();
  const reserve = useMutation({
    mutationFn: () => post<ReservationDto>('/api/member/reservations', { bookId: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['member', 'loans'] }),
  });
  const mine = book.data?.reviews.find((r) => r.mine);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const review = useMutation({
    mutationFn: () =>
      put<CatalogBookDetailDto>(`/api/member/catalog/books/${id}/review`, {
        rating: rating || mine?.rating,
        text,
      }),
    onSuccess: (d) => {
      qc.setQueryData(key, d);
      setText('');
      return qc.invalidateQueries({ queryKey: CATALOG_KEY });
    },
  });

  if (book.isError) return <ErrorText>{errorMessage(book.error)}</ErrorText>;
  if (!book.data) return <p className="text-gray-400">Loading…</p>;
  const b = book.data;

  return (
    <div className="max-w-4xl">
      <div className="flex flex-col gap-5 sm:flex-row">
        <BookCover url={b.coverUrl} title={b.title} className="h-60 w-44" />
        <div>
          <h1 className="text-2xl font-semibold">{b.title}</h1>
          <p className="text-gray-300">{b.authors.join(', ') || 'Unknown author'}</p>
          <p className="text-sm text-gray-400">
            {b.category} · {b.language}
            {b.publishedYear ? ` · ${b.publishedYear}` : ''}
          </p>
          <Stars value={b.ratingAvg} />{' '}
          <span className="text-sm text-gray-500">({b.ratingCount})</span>
          {b.donatedBy && <p className="mt-1 text-sm text-gray-400">Donated by {b.donatedBy}</p>}
          <div className="mt-3 text-sm">
            {b.availability.length === 0 ? (
              <p className="text-gray-400">All copies are out right now.</p>
            ) : (
              b.availability.map((a) => (
                <p key={a.branchName} className="text-emerald-400">
                  {a.available} available at {a.branchName}
                </p>
              ))
            )}
          </div>
          {b.availability.length === 0 && b.copies.total > 0 && (
            <div className="mt-4">
              {reserve.data ? (
                <p role="status" className="text-sm text-emerald-400">
                  Reserved. You are #{reserve.data.position} in the queue.
                </p>
              ) : (
                <Button busy={reserve.isPending} onClick={() => reserve.mutate()}>
                  Reserve
                </Button>
              )}
              <div className="mt-2">
                <ErrorText>{reserve.error ? errorMessage(reserve.error) : ''}</ErrorText>
              </div>
            </div>
          )}
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => toggle.mutate({ id: b.id, on: !b.inWishlist })}
          >
            {b.inWishlist ? '♥ In wishlist' : '♡ Add to wishlist'}
          </Button>
          {b.ebookUrl && (
            <a
              href={b.ebookUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-3 text-sm text-brand-500 hover:underline"
            >
              Read e-book
            </a>
          )}
        </div>
      </div>
      {b.description && <p className="mt-6 max-w-prose text-gray-300">{b.description}</p>}

      <h2 className="mt-8 text-lg font-semibold">Reviews</h2>
      <Card className="mt-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            review.mutate();
          }}
          className="space-y-3"
        >
          <div role="radiogroup" aria-label="Your rating" className="flex gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={(rating || mine?.rating) === n}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                onClick={() => setRating(n)}
                className={n <= (rating || mine?.rating || 0) ? 'text-yellow-400' : 'text-gray-600'}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            aria-label="Your review"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={mine?.text || 'What did you think?'}
            className="block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
          />
          <ErrorText>{review.error ? errorMessage(review.error) : ''}</ErrorText>
          <Button type="submit" disabled={!(rating || mine)} busy={review.isPending}>
            {mine ? 'Update review' : 'Post review'}
          </Button>
        </form>
      </Card>
      <ul className="mt-4 space-y-3">
        {b.reviews.map((r) => (
          <li key={r.id} className="rounded-lg border border-gray-800 p-3">
            <p className="text-sm">
              <span className="font-medium">
                {r.memberName}
                {r.mine ? ' (you)' : ''}
              </span>{' '}
              · <Stars value={r.rating} /> ·{' '}
              <span className="text-gray-500">{formatDate(r.createdAt)}</span>
            </p>
            {r.text && <p className="mt-1 text-gray-300">{r.text}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WishlistPage() {
  const list = useQuery({
    queryKey: [...CATALOG_KEY, 'wishlist'],
    queryFn: () => api<CatalogBookDto[]>('/api/member/catalog/wishlist'),
  });
  const toggle = useWishlistToggle();
  return (
    <div className="max-w-5xl">
      <PageHeader title="Wishlist" />
      {list.data?.length === 0 && (
        <p className="text-gray-400">Nothing here yet. Tap ♡ on a book to save it.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((b) => (
          <BookCard
            key={b.id}
            book={b}
            action={
              <button
                type="button"
                onClick={() => toggle.mutate({ id: b.id, on: false })}
                className="mt-1 text-sm text-gray-400 hover:text-gray-100"
              >
                Remove
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
