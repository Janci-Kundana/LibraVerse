import { act, fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, memberProfile, mockApi } from '../../test/mockApi';

// A fake socket whose events tests can fire.
const handlers = new Map<string, ((e: unknown) => void)[]>();
const fakeSocket = {
  connected: true,
  on: (ev: string, fn: (e: unknown) => void) => handlers.set(ev, [...(handlers.get(ev) ?? []), fn]),
  off: (ev: string, fn: (e: unknown) => void) =>
    handlers.set(
      ev,
      (handlers.get(ev) ?? []).filter((f) => f !== fn),
    ),
  emit: vi.fn(),
};
vi.mock('../../lib/socket', () => ({ getSocket: () => fakeSocket }));
const openCheckout = vi.fn().mockResolvedValue({});
vi.mock('../../lib/razorpay', () => ({ openCheckout: (...a: unknown[]) => openCheckout(...a) }));

function pushUpdate(paymentId: string, status: string) {
  act(() => handlers.get('payment:updated')?.forEach((fn) => fn({ paymentId, status })));
}

const payment = {
  id: 'p1',
  memberId: 'u1',
  memberName: 'Meera',
  purpose: 'membership',
  amount: 49900,
  discount: 0,
  couponCode: null,
  planName: 'Gold',
  method: 'online',
  status: 'created',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: new Date().toISOString(),
  paidAt: null,
  receiptNo: null,
  collectedByName: null,
  refund: null,
  lateCaptureRefunded: false,
};
const plan = {
  id: 'pl1',
  name: 'Gold',
  price: 49900,
  durationDays: 90,
  bookLimit: 4,
  finePerDay: 500,
  tier: 'gold',
  active: true,
};

beforeEach(() => handlers.clear());

describe('online payment (FR-20)', () => {
  it('opens Razorpay, then shows "Membership Activated" only when the server pushes success', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/member/profile': { status: 200, body: memberProfile('approved') },
      'GET /api/member/plans': { status: 200, body: [plan] },
      'POST /api/member/payments': {
        status: 201,
        body: {
          payment,
          orderId: 'order_1',
          keyId: 'rzp_test_x',
          libraryName: 'City',
          prefill: { name: 'Meera', email: 'm@x' },
        },
      },
      'POST /api/member/payments/p1/opened': { status: 204 },
      'GET /api/member/payments/p1': { status: 200, body: { ...payment, status: 'pending' } },
    });
    renderRoute(routes, '/member');
    fireEvent.change(await screen.findByLabelText('Coupon (optional)'), {
      target: { value: 'half' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Buy for ₹499' }));

    expect(await screen.findByText(/Waiting for payment of ₹499/)).toBeInTheDocument();
    expect(openCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'rzp_test_x', order_id: 'order_1', amount: 49900 }),
    );
    expect(calls.find((c) => c.path === '/api/member/payments')?.body).toEqual({
      purpose: 'membership',
      planId: 'pl1',
      couponCode: 'HALF',
    });
    expect(fakeSocket.emit).toHaveBeenCalledWith('payment:join', 'p1');

    pushUpdate('p1', 'success');
    expect(await screen.findByText('Membership Activated')).toBeInTheDocument();
  });
});

describe('counter payment (FR-17)', () => {
  const staff = {
    'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
    'GET /api/membership-plans': { status: 200, body: [plan] },
    'POST /api/circulation/scan-member': {
      status: 200,
      body: {
        memberId: 'u1',
        name: 'Meera',
        email: 'm@x',
        membershipNo: '1',
        planName: null,
        bookLimit: 0,
        validTill: null,
        membershipStatus: 'none',
        activeLoans: [],
        pendingDues: 0,
        canBorrow: false,
        blockedReason: 'No active membership plan',
        readyReservations: [],
      },
    },
  };

  async function scanAndChoosePlan() {
    renderRoute(routes, '/library/counter');
    const input = await screen.findByLabelText('Member card code');
    fireEvent.change(input, { target: { value: 'LV1.token' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('option', { name: /Gold/ });
    fireEvent.change(screen.getByLabelText('For'), { target: { value: 'pl1' } });
  }

  it('shows a UPI QR with a countdown and flips to "Payment Successful" live', async () => {
    mockApi({
      ...staff,
      'POST /api/payments/counter': {
        status: 201,
        body: {
          payment: { ...payment, method: 'counterUpi' },
          payUrl: 'http://x/pay/t',
          payQrDataUrl: 'data:image/png;base64,QQ',
        },
      },
      'GET /api/payments/p1': { status: 200, body: { ...payment, status: 'pending' } },
    });
    await scanAndChoosePlan();
    fireEvent.click(screen.getByRole('button', { name: 'UPI QR' }));
    expect(await screen.findByAltText('Payment QR code')).toBeInTheDocument();
    pushUpdate('p1', 'success');
    expect(await screen.findByText('Payment Successful')).toBeInTheDocument();
  });

  it('records cash (TC-04)', async () => {
    const calls = mockApi({
      ...staff,
      'POST /api/payments/counter': {
        status: 201,
        body: {
          payment: { ...payment, method: 'cash', status: 'success', receiptNo: 'CITY-1' },
          payUrl: null,
          payQrDataUrl: null,
        },
      },
    });
    await scanAndChoosePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Cash received' }));
    expect(
      await screen.findByText(/Payment Successful: ₹499 in cash, receipt CITY-1/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/payments/counter')?.body).toEqual({
      memberToken: 'LV1.token',
      method: 'cash',
      purpose: 'membership',
      planId: 'pl1',
    });
  });
});

describe('public pay link', () => {
  it('shows what is being paid and opens checkout', async () => {
    mockApi({
      'POST /api/pay/tok123/verify': {
        status: 200,
        body: {
          paymentId: 'p1',
          libraryName: 'City Library',
          description: 'Membership: Gold',
          amount: 49900,
          status: 'created',
          expiresAt: payment.expiresAt,
          orderId: 'order_1',
          keyId: 'rzp_test_x',
        },
      },
      'POST /api/pay/tok123/opened': { status: 204 },
    });
    renderRoute(routes, '/pay/tok123');
    fireEvent.click(await screen.findByRole('button', { name: 'Pay with UPI / card' }));
    await vi.waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(expect.objectContaining({ order_id: 'order_1' })),
    );
  });
});
