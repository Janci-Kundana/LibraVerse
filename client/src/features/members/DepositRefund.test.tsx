import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, memberProfile, mockApi } from '../../test/mockApi';

const refundView = (over: object = {}) => ({
  status: null,
  requestedAt: null,
  decidedAt: null,
  method: null,
  amount: 20000,
  depositBalance: 50000,
  outstandingDues: 30000,
  activeLoans: 0,
  blockedReason: null,
  note: null,
  ...over,
});

const member = (over: Record<string, unknown>) => ({
  'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
  'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
  'GET /api/member/profile': { status: 200, body: memberProfile('approved') },
  'GET /api/member/plans': { status: 200, body: [] },
  'GET /api/member/celebration': { status: 200, body: { celebration: null } },
  'GET /api/member/standing': {
    status: 200,
    body: {
      cardStatus: 'active',
      dueStatus: 'pending',
      outstandingDues: 30000,
      depositBalance: 50000,
      depositAmount: 50000,
      warningsSent: 1,
      deductionScheduledFor: null,
      history: [],
    },
  },
  ...over,
});

describe('member deposit refund', () => {
  it('explains the amount after dues and that the membership closes, then requests it', async () => {
    let requested = false;
    const view = () =>
      requested
        ? refundView({ status: 'requested', requestedAt: '2026-09-30T00:00:00Z' })
        : refundView();
    const calls = mockApi(
      member({
        'GET /api/member/deposit-refund': () => ({ status: 200, body: view() }),
        'POST /api/member/deposit-refund': () => {
          requested = true;
          return { status: 201, body: view() };
        },
      }),
    );
    renderRoute(routes, '/member');
    fireEvent.click(await screen.findByRole('button', { name: 'Request deposit refund' }));
    expect(screen.getByText(/your deposit ₹500 minus unpaid dues ₹300/)).toBeInTheDocument();
    expect(screen.getByText('your membership closes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Moving' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request refund and close membership' }));
    expect(await screen.findByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
    expect(
      calls.find((c) => c.method === 'POST' && c.path === '/api/member/deposit-refund')?.body,
    ).toEqual({ reason: 'Moving' });
  });

  it('shows why nothing can be refunded when the deposit is empty', async () => {
    mockApi(
      member({
        'GET /api/member/deposit-refund': {
          status: 200,
          body: refundView({
            amount: 0,
            depositBalance: 0,
            outstandingDues: 0,
            blockedReason: 'Your deposit is ₹0, so there is nothing to refund',
          }),
        },
      }),
    );
    renderRoute(routes, '/member');
    expect(
      await screen.findByText('Your deposit is ₹0, so there is nothing to refund.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request deposit refund' }),
    ).not.toBeInTheDocument();
  });
});

describe('staff refund queue', () => {
  it('refunds in cash; Razorpay is disabled when the deposit was not paid online', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/deposit-refunds': {
        status: 200,
        body: [
          {
            profileId: 'mp1',
            name: 'Meera',
            email: 'm@x',
            requestedAt: '2026-09-30T00:00:00Z',
            reason: 'Moving',
            depositBalance: 50000,
            outstandingDues: 30000,
            refundable: 20000,
            activeLoans: 0,
            razorpayRefundable: 0,
          },
        ],
      },
      'POST /api/deposit-refunds/mp1/approve': {
        status: 200,
        body: { amount: 20000, duesSettled: 30000, method: 'cash' },
      },
    });
    renderRoute(routes, '/library/deposit-refunds');
    expect(await screen.findByRole('button', { name: 'Refund via Razorpay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹200 in cash' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/api/deposit-refunds/mp1/approve')?.body).toEqual({
        method: 'cash',
      }),
    );
  });
});
