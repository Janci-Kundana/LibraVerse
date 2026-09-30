import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, mockApi } from '../../test/mockApi';

const base = {
  'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
  'GET /api/notifications': { status: 200, body: { unread: 0, items: [] } },
};

describe('in-app guide', () => {
  it('shows how to use the current page even without AI', async () => {
    mockApi({ ...base, 'GET /api/guide/status': { status: 200, body: { enabled: false } } });
    renderRoute(routes, '/library/counter');
    fireEvent.click(await screen.findByRole('button', { name: 'Open guide' }));
    const guide = screen.getByRole('dialog', { name: 'LibraVerse guide' });
    expect(guide).toHaveTextContent('On this page');
    expect(guide).toHaveTextContent(/Scan the member’s card/);
    expect(await screen.findByText(/Chat answers are not switched on yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Ask the guide')).not.toBeInTheDocument();
  });

  it('asks with the current page and links only to allowed pages', async () => {
    const calls = mockApi({
      ...base,
      'GET /api/guide/status': { status: 200, body: { enabled: true } },
      'POST /api/guide': {
        status: 200,
        body: {
          reply: 'Go to the [Counter](/library/counter). Admins use [Settings](/library/settings).',
        },
      },
    });
    renderRoute(routes, '/library/loans');
    fireEvent.click(await screen.findByRole('button', { name: 'Open guide' }));
    fireEvent.click(await screen.findByRole('button', { name: 'How do I issue a book?' }));

    expect(await screen.findByRole('link', { name: 'Counter' })).toHaveAttribute(
      'href',
      '/library/counter',
    );
    // A librarian cannot open Settings, so it stays plain text.
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByText(/Admins use Settings/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/guide')?.body).toEqual({
      page: '/library/loans',
      messages: [{ role: 'user', content: 'How do I issue a book?' }],
    });
  });
});
