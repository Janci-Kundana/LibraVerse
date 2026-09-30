import { fireEvent, screen, within } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, memberProfile, mockApi } from '../../test/mockApi';

const plan = (id: string, name: string, price: number, durationDays: number) => ({
  id,
  name,
  price,
  durationDays,
  bookLimit: 2,
  finePerDay: 500,
  tier: 'member',
  active: true,
});

const home = (profile: object) => ({
  'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
  'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
  'GET /api/member/celebration': { status: 200, body: { celebration: null } },
  'GET /api/member/profile': { status: 200, body: { ...memberProfile('approved'), ...profile } },
  'GET /api/member/plans': {
    status: 200,
    body: [plan('gold', 'Gold', 49900, 90), plan('silver', 'Silver', 19900, 30)],
  },
});

const card = (name: string) =>
  screen.getByText(name, { selector: 'p.font-semibold' }).closest('div.flex.h-full') as HTMLElement;

describe('member home: plan changes start when the current period ends', () => {
  it('says when a different plan would start, and that the same plan adds days', async () => {
    mockApi(home({ planId: 'gold', planName: 'Gold', validTill: '2099-10-29T00:00:00.000Z' }));
    renderRoute(routes, '/member');
    await screen.findByText('Silver', { selector: 'p.font-semibold' });
    expect(
      within(card('Silver')).getByText(/^Starts .*, when your Gold plan ends$/),
    ).toBeInTheDocument();
    expect(within(card('Gold')).getByText(/^Adds 90 days after /)).toBeInTheDocument();
    expect(
      within(card('Silver')).getByRole('button', { name: 'Buy for ₹199' }),
    ).toBeInTheDocument();
  });

  it('with a change scheduled, shows it and only offers more of that plan', async () => {
    mockApi(
      home({
        planId: 'gold',
        planName: 'Gold',
        validTill: '2099-12-29T00:00:00.000Z',
        nextPlan: { planId: 'silver', planName: 'Silver', startsAt: '2099-10-29T00:00:00.000Z' },
      }),
    );
    renderRoute(routes, '/member');
    expect(await screen.findByText(/^Then Silver from /)).toBeInTheDocument();
    await screen.findByText('Gold', { selector: 'p.font-semibold' });
    expect(within(card('Gold')).getByText(/^Silver already starts on /)).toBeInTheDocument();
    expect(within(card('Gold')).queryByRole('button', { name: /Buy for/ })).not.toBeInTheDocument();
    expect(within(card('Silver')).getByText(/^Adds 30 days to Silver/)).toBeInTheDocument();
  });
});

describe('card photo after approval', () => {
  it('sends a new photo for staff approval and shows it is waiting', async () => {
    // jsdom cannot make preview URLs for files; browsers can.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    let waiting = false;
    const calls = mockApi({
      ...home({}),
      'GET /api/member/profile': () => ({
        status: 200,
        body: {
          ...memberProfile('approved'),
          photoChange: waiting
            ? { status: 'pending', requestedAt: '2026-09-30T10:00:00.000Z', note: null }
            : null,
        },
      }),
      'POST /api/member/photo': () => {
        waiting = true;
        return { status: 200, body: {} };
      },
    });
    renderRoute(routes, '/member');
    const face = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', {
      type: 'image/png',
    });
    fireEvent.change(await screen.findByLabelText('Card photo'), { target: { files: [face] } });
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    expect(await screen.findByText('New photo waiting for staff approval')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/member/photo')?.body).toEqual({
      photo: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it('shows why staff turned a photo down', async () => {
    mockApi(
      home({
        photoChange: {
          status: 'rejected',
          requestedAt: '2026-09-30T10:00:00.000Z',
          note: 'Face not visible',
        },
      }),
    );
    renderRoute(routes, '/member');
    expect(
      await screen.findByText(/Your new photo was not approved: Face not visible/),
    ).toBeInTheDocument();
  });
});

describe('staff: new card photos', () => {
  it('lists waiting photos next to the current one and approves', async () => {
    let queue = [
      {
        profileId: 'mp9',
        name: 'Priya Sharma',
        email: 'priya@x.test',
        membershipNo: '4123',
        requestedAt: '2026-09-30T10:00:00.000Z',
        hasCurrentPhoto: true,
      },
    ];
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
      'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
      'GET /api/verifications': { status: 200, body: [] },
      'GET /api/verifications/photo-changes': () => ({ status: 200, body: queue }),
      'POST /api/verifications/photo-changes/mp9/approve': () => {
        queue = [];
        return { status: 204 };
      },
    });
    renderRoute(routes, '/library/verifications');
    expect(await screen.findByRole('heading', { name: 'New card photos (1)' })).toBeInTheDocument();
    expect(screen.getByAltText('Current photo of Priya Sharma')).toHaveAttribute(
      'src',
      '/api/members/mp9/photo',
    );
    expect(screen.getByAltText('New photo of Priya Sharma')).toHaveAttribute(
      'src',
      '/api/verifications/photo-changes/mp9/photo',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve photo' }));
    await vi.waitFor(() =>
      expect(screen.queryByRole('heading', { name: /New card photos/ })).not.toBeInTheDocument(),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/mp9/approve'))).toBe(true);
  });
});
