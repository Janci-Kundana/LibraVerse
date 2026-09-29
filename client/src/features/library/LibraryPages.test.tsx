import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, mockApi } from '../../test/mockApi';

const me = (role: 'libraryAdmin' | 'librarian') => ({
  'GET /api/auth/me': { status: 200, body: { user: authUser(role) } },
});

describe('library admin pages', () => {
  it('keeps librarians out of admin-only pages', async () => {
    mockApi({ ...me('librarian') });
    renderRoute(routes, '/library/staff');
    expect(await screen.findByRole('heading', { name: 'Library dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
  });

  it('creates a membership plan, sending rupees as integer paise', async () => {
    const calls = mockApi({
      ...me('libraryAdmin'),
      'GET /api/membership-plans': { status: 200, body: [] },
      'GET /api/coupons': { status: 200, body: [] },
      'POST /api/membership-plans': { status: 201, body: {} },
    });
    renderRoute(routes, '/library/plans');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Gold' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '499.50' } });
    fireEvent.change(screen.getByLabelText('Fine per day (₹)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));
    await vi.waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/api/membership-plans')?.body,
      ).toEqual({
        name: 'Gold',
        price: 49950,
        durationDays: 30,
        bookLimit: 2,
        finePerDay: 500,
        tier: 'member',
      }),
    );
  });

  it('adds a librarian', async () => {
    const calls = mockApi({
      ...me('libraryAdmin'),
      'GET /api/staff': { status: 200, body: [] },
      'GET /api/branches': { status: 200, body: [{ id: 'b1', name: 'Main', address: '' }] },
      'POST /api/staff': { status: 201, body: {} },
    });
    renderRoute(routes, '/library/staff');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Ravi' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ravi@x.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add librarian' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Ravi',
        email: 'ravi@x.test',
        branchId: null,
      }),
    );
  });
});

describe('ID verification queue (FR-13)', () => {
  it('librarian approves, and rejects with a reason', async () => {
    const calls = mockApi({
      ...me('librarian'),
      'GET /api/verifications?status=pending': {
        status: 200,
        body: [
          {
            profileId: 'm1',
            name: 'Meera',
            email: 'meera@x.test',
            phone: null,
            status: 'pending',
            note: null,
            submittedAt: '2026-09-30T00:00:00Z',
          },
          {
            profileId: 'm2',
            name: 'Arjun',
            email: 'arjun@x.test',
            phone: null,
            status: 'pending',
            note: null,
            submittedAt: '2026-09-30T00:00:00Z',
          },
        ],
      },
      'POST /api/verifications/m1/approve': { status: 200, body: {} },
      'POST /api/verifications/m2/reject': { status: 200, body: {} },
    });
    renderRoute(routes, '/library/verifications');
    expect(await screen.findByText('Meera')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View ID proof' })[0]).toHaveAttribute(
      'href',
      '/api/verifications/m1/id-proof',
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[1]!);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Blurry photo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));
    await vi.waitFor(() =>
      expect(calls.find((c) => c.path === '/api/verifications/m2/reject')?.body).toEqual({
        reason: 'Blurry photo',
      }),
    );

    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve' }))[0]!);
    await vi.waitFor(() =>
      expect(calls.some((c) => c.path === '/api/verifications/m1/approve')).toBe(true),
    );
  });
});
