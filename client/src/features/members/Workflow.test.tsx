import { act, fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, memberProfile, mockApi } from '../../test/mockApi';

const openCheckout = vi.fn();
vi.mock('../../lib/razorpay', () => ({ openCheckout: (o: unknown) => openCheckout(o) }));

const standing = (over: object = {}) => ({
  cardStatus: 'active',
  dueStatus: 'none',
  outstandingDues: 0,
  depositBalance: 50000,
  depositAmount: 50000,
  warningsSent: 0,
  deductionScheduledFor: null,
  history: [],
  ...over,
});

const member = (over: Record<string, unknown> = {}) => ({
  'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
  'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
  'GET /api/member/profile': { status: 200, body: memberProfile('approved') },
  'GET /api/member/plans': { status: 200, body: [] },
  'GET /api/member/standing': { status: 200, body: standing() },
  'GET /api/member/celebration': { status: 200, body: { celebration: null } },
  ...over,
});

describe('member deposit and dues', () => {
  it('shows a blocked card with the amount owed and the deposit history', async () => {
    mockApi(
      member({
        'GET /api/member/standing': {
          status: 200,
          body: standing({
            cardStatus: 'blocked',
            dueStatus: 'blocked',
            outstandingDues: 20000,
            depositBalance: 0,
            history: [
              {
                id: 't1',
                type: 'deduction',
                amount: 10000,
                balanceAfter: 0,
                dueBefore: 30000,
                dueAfter: 20000,
                reason: 'x',
                createdAt: '2026-09-30T00:00:00Z',
              },
            ],
          }),
        },
      }),
    );
    renderRoute(routes, '/member');
    expect(await screen.findByText('Card blocked')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your deposit is used up and ₹200 is still owed',
    );
    fireEvent.click(screen.getByText('Deposit history'));
    expect(screen.getByText(/−₹100 · balance ₹0/)).toBeInTheDocument();
  });
});

describe('membership celebration', () => {
  it('appears only after a confirmed payment, with the plan details, and is dismissed once', async () => {
    const calls = mockApi(
      member({
        'GET /api/member/celebration': {
          status: 200,
          body: {
            celebration: {
              paymentId: 'p1',
              planName: 'Gold',
              tier: 'gold',
              validTill: '2026-12-31T00:00:00Z',
              amount: 99900,
              depositCollected: 50000,
              renewal: false,
            },
          },
        },
        'GET /api/member/card': {
          status: 200,
          body: {
            name: 'Meera',
            libraryName: 'City',
            libraryInitial: 'C',
            logoUrl: null,
            cardColours: [],
            membershipNo: '4123456789012345',
            memberSince: '2026-01-01T00:00:00Z',
            validTill: '2026-12-31T00:00:00Z',
            tier: 'gold',
            status: 'active',
            qrToken: 'LV1.x',
            qrDataUrl: 'data:image/png;base64,AA',
            revealed: true,
            hasPhoto: false,
          },
        },
        'POST /api/member/celebration/p1/seen': { status: 204 },
      }),
    );
    renderRoute(routes, '/member');
    expect(
      await screen.findByRole('heading', { name: 'Congratulations! Your membership is active!' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('₹999')).toBeInTheDocument();
    expect(screen.getByText('₹500 (refundable)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/api/member/celebration/p1/seen')).toBe(true),
    );
  });
});

describe('payment flow', () => {
  it('asks the server to verify when Razorpay finishes, and to cancel when closed', async () => {
    const calls = mockApi(
      member({
        'GET /api/member/plans': {
          status: 200,
          body: [
            {
              id: 'pl1',
              name: 'Gold',
              price: 49900,
              durationDays: 90,
              bookLimit: 4,
              finePerDay: 500,
              tier: 'gold',
              active: true,
            },
          ],
        },
        'POST /api/member/payments': {
          status: 201,
          body: {
            payment: {
              id: 'p1',
              status: 'created',
              amount: 99900,
              expiresAt: new Date(Date.now() + 6e5).toISOString(),
              purpose: 'membership',
              planName: 'Gold',
            },
            orderId: 'order_1',
            keyId: 'rzp_test_x',
            libraryName: 'City',
            prefill: { name: 'M', email: 'm@x' },
          },
        },
        'POST /api/member/payments/p1/opened': { status: 204 },
        'POST /api/member/payments/p1/verify': {
          status: 200,
          body: { id: 'p1', status: 'pending' },
        },
        'POST /api/member/payments/p1/cancel': {
          status: 200,
          body: { id: 'p1', status: 'failed' },
        },
      }),
    );
    renderRoute(routes, '/member');
    fireEvent.click(await screen.findByRole('button', { name: 'Buy for ₹499' }));
    await vi.waitFor(() => expect(openCheckout).toHaveBeenCalled());
    const opts = openCheckout.mock.calls[0]![0] as {
      handler: () => void;
      modal: { ondismiss: () => void };
    };
    act(() => opts.handler());
    act(() => opts.modal.ondismiss());
    await vi.waitFor(() => {
      expect(calls.some((c) => c.path === '/api/member/payments/p1/verify')).toBe(true);
      expect(calls.some((c) => c.path === '/api/member/payments/p1/cancel')).toBe(true);
    });
  });
});

describe('counter scan', () => {
  it('shows photo, contact, dates, plan, dues, deposit, status and library', async () => {
    mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/membership-plans': { status: 200, body: [] },
      'POST /api/circulation/scan-member': {
        status: 200,
        body: {
          memberId: 'u1',
          profileId: 'mp1',
          name: 'Meera Nair',
          email: 'm@x',
          phone: '+91 98765 43210',
          photoUrl: '/api/members/mp1/photo',
          libraryName: 'City Library',
          cardIssuedAt: '2026-01-05T00:00:00Z',
          membershipStartedAt: '2026-09-01T00:00:00Z',
          depositBalance: 0,
          cardStatus: 'blocked',
          dueStatus: 'blocked',
          membershipNo: '4123456789012345',
          planName: 'Gold',
          bookLimit: 4,
          validTill: '2026-12-31T00:00:00Z',
          membershipStatus: 'active',
          activeLoans: [],
          pendingDues: 20000,
          canBorrow: false,
          blockedReason:
            'Card blocked: the deposit is used up and ₹200 is still due. Collect it to unblock.',
          readyReservations: [],
        },
      },
    });
    renderRoute(routes, '/library/counter');
    const input = await screen.findByLabelText('Member card code');
    fireEvent.change(input, { target: { value: 'LV1.token' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByAltText('Photo of Meera Nair')).toHaveAttribute(
      'src',
      '/api/members/mp1/photo',
    );
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument();
    expect(screen.getByText('Library', { selector: 'dt' }).nextElementSibling).toHaveTextContent(
      'City Library',
    );
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('₹200')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Card blocked: the deposit is used up');
  });
});
