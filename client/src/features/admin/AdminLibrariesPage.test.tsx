import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, mockApi } from '../../test/mockApi';

const pending = [
  {
    id: 'l1',
    name: 'City Library',
    slug: 'city',
    status: 'pending',
    ownerName: 'Asha Rao',
    contactEmail: 'asha@city.test',
    planCode: 'free',
    createdAt: '2026-09-30T00:00:00.000Z',
    statusReason: null,
  },
];

describe('AdminLibrariesPage', () => {
  function setup() {
    return mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('superAdmin') } },
      'GET /api/admin/libraries?status=pending': { status: 200, body: pending },
      'POST /api/admin/libraries/l1/approve': { status: 200, body: { id: 'l1', status: 'active' } },
      'POST /api/admin/libraries/l1/reject': {
        status: 200,
        body: { id: 'l1', status: 'rejected' },
      },
    });
  }

  it('approves a pending library', async () => {
    const calls = setup();
    renderRoute(routes, '/admin');
    expect(await screen.findByText('City Library')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findAllByText('City Library');
    await vi.waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.path === '/api/admin/libraries/l1/approve'),
      ).toBe(true),
    );
  });

  it('asks for a reason before rejecting and sends it', async () => {
    const calls = setup();
    renderRoute(routes, '/admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText(/Reason to reject/), {
      target: { value: 'Could not verify' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/api/admin/libraries/l1/reject')?.body).toEqual({
        reason: 'Could not verify',
      }),
    );
  });
});
