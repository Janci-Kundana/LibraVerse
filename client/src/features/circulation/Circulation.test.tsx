import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { approvedMemberRoutes, authUser, mockApi } from '../../test/mockApi';

const loan = {
  id: 'l1',
  bookId: 'b1',
  bookTitle: 'Dune',
  copyCode: 'LVC-abc',
  memberId: 'm1',
  memberName: 'Meera',
  issuedAt: '2026-09-01T00:00:00Z',
  dueAt: '2026-09-15T00:00:00Z',
  returnedAt: null,
  status: 'active',
  renewals: 0,
  overdueDays: 3,
  fineAmount: 1500,
  damageCharge: 0,
  chargeNote: null,
  duesPaid: false,
};

const scan = (over: object) => ({
  memberId: 'm1',
  name: 'Meera',
  email: 'meera@x.test',
  membershipNo: '4123456789012345',
  planName: 'Gold',
  bookLimit: 2,
  validTill: '2026-12-31T00:00:00Z',
  membershipStatus: 'active',
  activeLoans: [],
  pendingDues: 0,
  canBorrow: true,
  blockedReason: null,
  readyReservations: [],
  ...over,
});

const staff = { 'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } } };

async function typeAndGo(label: string, value: string) {
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
}

describe('counter', () => {
  it('issues a book with two scans', async () => {
    const calls = mockApi({
      ...staff,
      'POST /api/circulation/scan-member': { status: 200, body: scan({}) },
      'POST /api/circulation/issue': {
        status: 201,
        body: { ...loan, overdueDays: 0, fineAmount: 0 },
      },
    });
    renderRoute(routes, '/library/counter');
    await typeAndGo('Member card code', 'LV1.token');
    expect(await screen.findByText('Can borrow 2 more.')).toBeInTheDocument();
    await typeAndGo('Book copy code', 'LVC-abc');
    expect(await screen.findByText(/Issued “Dune” to Meera/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/circulation/issue')?.body).toEqual({
      memberToken: 'LV1.token',
      copyCode: 'LVC-abc',
    });
  });

  it('TC-05: shows why a member with a pending fine cannot borrow, and hides the book scan', async () => {
    mockApi({
      ...staff,
      'POST /api/circulation/scan-member': {
        status: 200,
        body: scan({
          canBorrow: false,
          pendingDues: 1500,
          blockedReason: 'Pending fine of ₹15. Collect payment before issuing.',
        }),
      },
    });
    renderRoute(routes, '/library/counter');
    await typeAndGo('Member card code', 'LV1.token');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Cannot issue: Pending fine of ₹15. Collect payment before issuing.',
    );
    expect(screen.queryByLabelText('Book copy code')).not.toBeInTheDocument();
  });

  it('TC-06: a late return shows the fine before confirming', async () => {
    const calls = mockApi({
      ...staff,
      'GET /api/circulation/copies/LVC-abc': {
        status: 200,
        body: { copyCode: 'LVC-abc', bookTitle: 'Dune', status: 'issued', activeLoan: loan },
      },
      'POST /api/circulation/return': {
        status: 200,
        body: { loan: { ...loan, status: 'returned' }, heldFor: 'Arjun' },
      },
    });
    renderRoute(routes, '/library/counter');
    fireEvent.click(await screen.findByRole('tab', { name: 'Return' }));
    await typeAndGo('Book copy code', 'LVC-abc');
    expect(await screen.findByText('Returned 3 days late: fine ₹15.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm return' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "₹15 added to Meera's dues. Put it aside: it is reserved for Arjun.",
    );
    expect(calls.find((c) => c.path === '/api/circulation/return')?.body).toEqual({
      copyCode: 'LVC-abc',
      condition: 'ok',
    });
  });
});

describe('member side', () => {
  const member = {
    ...approvedMemberRoutes,
    'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
  };

  it('shows the card with its QR', async () => {
    mockApi({
      ...member,
      'GET /api/member/card': {
        status: 200,
        body: {
          name: 'Meera',
          libraryName: 'City Library',
          libraryInitial: 'C',
          logoUrl: null,
          cardColours: [],
          membershipNo: '4123456789012345',
          memberSince: '2026-01-01T00:00:00Z',
          validTill: '2026-12-31T00:00:00Z',
          tier: 'gold',
          status: 'active',
          qrToken: 'LV1.x',
          qrDataUrl: 'data:image/png;base64,AAAA',
          revealed: true,
        },
      },
    });
    renderRoute(routes, '/member/card');
    expect(await screen.findByAltText('Membership QR code')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    expect(screen.getByText('4123 4567 8901 2345')).toBeInTheDocument();
  });

  it('lists loans with dues and renews one', async () => {
    const calls = mockApi({
      ...member,
      'GET /api/member/loans': {
        status: 200,
        body: {
          current: [{ ...loan, overdueDays: 0, fineAmount: 0 }],
          history: [],
          pendingDues: 2000,
          reservations: [],
        },
      },
      'POST /api/member/loans/l1/renew': { status: 200, body: loan },
    });
    renderRoute(routes, '/member/loans');
    expect(await screen.findByRole('alert')).toHaveTextContent('You owe ₹20 in fines.');
    fireEvent.click(screen.getByRole('button', { name: 'Renew' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/api/member/loans/l1/renew')).toBe(true),
    );
  });

  it('reserves a book with no copies on the shelf', async () => {
    const detail = {
      id: 'b1',
      title: 'Dune',
      authors: [],
      isbn: null,
      category: 'Fiction',
      language: 'English',
      description: '',
      publishedYear: null,
      coverUrl: null,
      ebookUrl: null,
      createdAt: '2026-09-01T00:00:00Z',
      copies: { total: 1, available: 0 },
      ratingAvg: null,
      ratingCount: 0,
      donatedBy: null,
      inWishlist: false,
      reviews: [],
      availability: [],
    };
    mockApi({
      ...member,
      'GET /api/member/catalog/books/b1': { status: 200, body: detail },
      'POST /api/member/reservations': {
        status: 201,
        body: { id: 'r1', position: 2, status: 'waiting' },
      },
    });
    renderRoute(routes, '/member/books/b1');
    fireEvent.click(await screen.findByRole('button', { name: 'Reserve' }));
    expect(await screen.findByText('Reserved. You are #2 in the queue.')).toBeInTheDocument();
  });
});
