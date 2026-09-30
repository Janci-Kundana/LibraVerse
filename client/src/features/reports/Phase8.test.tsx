import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { approvedMemberRoutes, authUser, mockApi } from '../../test/mockApi';

const month = (i: number) => `2026-${String(i + 1).padStart(2, '0')}`;

describe('library dashboard (FR-11)', () => {
  it('shows totals, charts with table views, and export links', async () => {
    mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('libraryAdmin') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/reports/dashboard': {
        status: 200,
        body: {
          totals: {
            members: 42,
            pendingVerifications: 3,
            titles: 120,
            copies: 300,
            activeLoans: 17,
            overdueLoans: 2,
            revenueThisMonth: 499000,
            outstandingDues: 1500,
          },
          revenueByMonth: Array.from({ length: 12 }, (_, i) => ({
            month: month(i),
            value: i * 10000,
          })),
          loansByDay: Array.from({ length: 30 }, (_, i) => ({
            day: `2026-09-${String(i + 1).padStart(2, '0')}`,
            value: i % 4,
          })),
          popularBooks: [{ id: 'b1', title: 'Dune', borrows: 9 }],
        },
      },
    });
    renderRoute(routes, '/library');
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('₹4,990')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Revenue by month (net of refunds)' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Show as table')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Excel' })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/api\/reports\/payments\.xlsx\?from=/),
    );
  });
});

describe('assistant (FR-25)', () => {
  it('sends the conversation and shows the reply', async () => {
    const calls = mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/member/assistant/status': { status: 200, body: { enabled: true } },
      'POST /api/member/assistant': { status: 200, body: { reply: 'The late fine is ₹5 a day.' } },
    });
    renderRoute(routes, '/member/assistant');
    fireEvent.click(await screen.findByRole('button', { name: 'What is the late fine?' }));
    expect(await screen.findByText('The late fine is ₹5 a day.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      messages: [{ role: 'user', content: 'What is the late fine?' }],
    });
  });
});

describe('Google sign-in', () => {
  it('renders the Google button only when the server enables it', async () => {
    const renderButton = vi.fn();
    window.google = { accounts: { id: { initialize: vi.fn(), renderButton } } };
    mockApi({
      'GET /api/auth/config': {
        status: 200,
        body: { googleClientId: 'cid.apps.googleusercontent.com' },
      },
    });
    renderRoute(routes, '/login');
    await vi.waitFor(() => expect(renderButton).toHaveBeenCalled());
    delete window.google;
  });
});
