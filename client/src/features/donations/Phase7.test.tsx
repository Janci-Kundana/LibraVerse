import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, mockApi } from '../../test/mockApi';

const openCheckout = vi.fn().mockResolvedValue({});
vi.mock('../../lib/razorpay', () => ({ openCheckout: (...a: unknown[]) => openCheckout(...a) }));

describe('donations', () => {
  it('a visitor offers a book to a chosen library', async () => {
    const calls = mockApi({
      'GET /api/public/libraries': {
        status: 200,
        body: [{ name: 'City Library', slug: 'city', logoUrl: null }],
      },
      'POST /api/public/libraries/city/donations': { status: 201, body: {} },
    });
    renderRoute(routes, '/donate');
    fireEvent.click(await screen.findByRole('button', { name: 'City Library' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'ravi@x.test' } });
    fireEvent.change(screen.getByLabelText('Book title'), { target: { value: 'The Guide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Offer this book' }));
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      donorName: 'Ravi',
      title: 'The Guide',
      condition: 'good',
      anonymous: false,
    });
  });

  it('staff accept an offer', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/branches': { status: 200, body: [] },
      'GET /api/donations?status=offered': {
        status: 200,
        body: [
          {
            id: 'd1',
            donorName: 'Ravi',
            donorEmail: 'r@x',
            anonymous: false,
            isMember: false,
            title: 'The Guide',
            author: '',
            condition: 'good',
            message: '',
            status: 'offered',
            bookId: null,
            createdAt: '2026-09-30T00:00:00Z',
          },
        ],
      },
      'POST /api/donations/d1/accept': { status: 200, body: {} },
    });
    renderRoute(routes, '/library/donations');
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/api/donations/d1/accept')).toBe(true),
    );
  });
});

describe('billing and notifications', () => {
  it('registering on Pro opens the platform checkout', async () => {
    mockApi({
      'GET /api/platform-plans': {
        status: 200,
        body: [
          {
            id: 'p1',
            code: 'free',
            name: 'Free',
            monthlyPrice: 0,
            memberLimit: 100,
            branchLimit: 1,
            active: true,
          },
          {
            id: 'p2',
            code: 'pro',
            name: 'Pro',
            monthlyPrice: 99900,
            memberLimit: null,
            branchLimit: 10,
            active: true,
          },
        ],
      },
      'POST /api/libraries/register': {
        status: 201,
        body: {
          id: 'l1',
          checkout: {
            paymentId: 'x',
            orderId: 'order_p1',
            keyId: 'rzp_test_platform',
            amount: 99900,
            expiresAt: new Date(Date.now() + 9e5).toISOString(),
            description: 'Pro',
          },
        },
      },
    });
    renderRoute(routes, '/register-library');
    fireEvent.click(await screen.findByText('Pro'));
    fireEvent.change(screen.getByLabelText('Library name'), { target: { value: 'Pro Reads' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha' } });
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'a@x.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register library' }));
    await vi.waitFor(() =>
      expect(openCheckout).toHaveBeenCalledWith(
        expect.objectContaining({ order_id: 'order_p1', amount: 99900 }),
      ),
    );
  });

  it('shows unread notifications in the bell', async () => {
    mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/notifications': {
        status: 200,
        body: {
          unread: 2,
          items: [
            {
              id: 'n1',
              title: 'Book ready',
              message: 'Come',
              read: false,
              createdAt: '2026-09-30T00:00:00Z',
            },
          ],
        },
      },
    });
    renderRoute(routes, '/library');
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications (2 unread)' }));
    expect(screen.getByText('Book ready')).toBeInTheDocument();
  });
});
