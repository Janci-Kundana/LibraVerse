import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { approvedMemberRoutes, authUser, memberProfile, mockApi } from '../../test/mockApi';

const book = {
  id: 'b1',
  title: 'Dune',
  authors: ['Frank Herbert'],
  isbn: '9780441172719',
  category: 'Science fiction',
  language: 'English',
  description: '',
  publishedYear: 1965,
  coverUrl: null,
  ebookUrl: null,
  createdAt: '2026-09-30T00:00:00Z',
  copies: { total: 2, available: 1 },
  ratingAvg: 4,
  ratingCount: 1,
  donatedBy: null,
};

describe('staff catalog (FR-14)', () => {
  it('auto-fills a new book from its ISBN and creates it with copies', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/branches': { status: 200, body: [{ id: 'br1', name: 'Main', address: '' }] },
      'GET /api/books/isbn/9780441172719': {
        status: 200,
        body: {
          isbn: '9780441172719',
          title: 'Dune',
          authors: ['Frank Herbert'],
          publishedYear: 1965,
          category: 'Science fiction',
          coverUrl: null,
          description: '',
        },
      },
      'POST /api/books': { status: 201, body: { ...book, copyList: [] } },
      'GET /api/books/b1': { status: 200, body: { ...book, copyList: [] } },
    });
    renderRoute(routes, '/library/catalog/new');
    fireEvent.change(await screen.findByLabelText('ISBN'), { target: { value: '9780441172719' } });
    fireEvent.click(screen.getByRole('button', { name: 'Auto-fill' }));
    expect(await screen.findByDisplayValue('Frank Herbert')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Dune');

    fireEvent.change(screen.getByLabelText('Copies'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Shelf'), { target: { value: 'A-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add book' }));

    expect(await screen.findByRole('heading', { name: 'Dune' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/books')?.body).toMatchObject({
      title: 'Dune',
      authors: ['Frank Herbert'],
      isbn: '9780441172719',
      publishedYear: 1965,
      copies: { count: 3, branchId: 'br1', shelf: 'A-3' },
    });
  });

  it('shows each copy with its QR code and a sticker-sheet link', async () => {
    mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/branches': { status: 200, body: [] },
      'GET /api/books/b1': {
        status: 200,
        body: {
          ...book,
          copyList: [
            {
              id: 'c1',
              bookId: 'b1',
              branchId: 'br1',
              branchName: 'Main',
              qrCode: 'LVC-abc123def456',
              shelf: 'A-3',
              status: 'available',
            },
          ],
        },
      },
    });
    renderRoute(routes, '/library/catalog/b1');
    expect(await screen.findByRole('link', { name: 'LVC-abc123def456' })).toHaveAttribute(
      'href',
      '/api/copies/c1/qr.png',
    );
    expect(screen.getByRole('link', { name: 'Print QR stickers' })).toHaveAttribute(
      'href',
      '/api/books/stickers.pdf?bookId=b1',
    );
  });
});

describe('member discovery (FR-19)', () => {
  const member = {
    ...approvedMemberRoutes,
    'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
    'GET /api/member/catalog/facets': {
      status: 200,
      body: { categories: ['Science fiction'], languages: ['English'] },
    },
  };

  it('searches and adds a book to the wishlist', async () => {
    const calls = mockApi({
      ...member,
      'GET /api/member/catalog/books': {
        status: 200,
        body: { items: [{ ...book, inWishlist: false }], total: 1, page: 1, pageSize: 20 },
      },
      'PUT /api/member/catalog/wishlist/b1': { status: 204 },
    });
    renderRoute(routes, '/member/catalog');
    fireEvent.change(await screen.findByLabelText('Search'), { target: { value: 'dune' } });
    fireEvent.click(await screen.findByRole('button', { name: '♡ Add to wishlist' }));
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path.startsWith('/api/member/catalog/books?q=dune'))).toBe(true);
      expect(
        calls.some((c) => c.method === 'PUT' && c.path === '/api/member/catalog/wishlist/b1'),
      ).toBe(true);
    });
  });

  it('posts a star rating and review', async () => {
    const detail = {
      ...book,
      inWishlist: false,
      reviews: [],
      availability: [{ branchName: 'Main', available: 1 }],
    };
    const calls = mockApi({
      ...member,
      'GET /api/member/catalog/books/b1': { status: 200, body: detail },
      'PUT /api/member/catalog/books/b1/review': { status: 200, body: detail },
    });
    renderRoute(routes, '/member/books/b1');
    expect(await screen.findByText('1 available at Main')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    fireEvent.change(screen.getByLabelText('Your review'), { target: { value: 'Loved it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ rating: 5, text: 'Loved it' }),
    );
  });

  it('keeps unverified members on the pending screen', async () => {
    mockApi({
      ...member,
      'GET /api/member/profile': { status: 200, body: memberProfile('pending') },
    });
    renderRoute(routes, '/member/catalog');
    expect(
      await screen.findByRole('heading', { name: 'Verification pending' }),
    ).toBeInTheDocument();
  });
});
