import { screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { approvedMemberRoutes, authUser, mockApi, unauthenticated } from '../../test/mockApi';

describe('role guards', () => {
  it('sends signed-out visitors to the login page, after trying a refresh', async () => {
    const calls = mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': unauthenticated,
      'POST /api/auth/refresh': unauthenticated,
    });
    renderRoute(routes, '/library');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/auth/me',
      'POST /api/auth/refresh',
    ]);
  });

  it('renews an expired session silently and stays on the page', async () => {
    let refreshed = false;
    mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': () =>
        refreshed ? { status: 200, body: { user: authUser('librarian') } } : unauthenticated,
      'POST /api/auth/refresh': () => {
        refreshed = true;
        return { status: 200, body: {} };
      },
    });
    renderRoute(routes, '/library');
    expect(await screen.findByRole('heading', { name: 'Library dashboard' })).toBeInTheDocument();
  });

  it.each([
    ['librarian', '/library', 'Library dashboard'],
    ['libraryAdmin', '/library', 'Library dashboard'],
    ['member', '/member', 'Home'],
  ] as const)('lets a %s into %s', async (role, path, heading) => {
    mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser(role) } },
    });
    renderRoute(routes, path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each([
    ['member', '/library', 'Home'],
    ['librarian', '/admin', 'Library dashboard'],
    ['member', '/admin', 'Home'],
  ] as const)('redirects a %s away from %s to their own home', async (role, path, heading) => {
    mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser(role) } },
    });
    renderRoute(routes, path);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('shows staff the Security page but not members', async () => {
    mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser('librarian') } },
    });
    renderRoute(routes, '/library');
    expect(await screen.findByRole('link', { name: 'Security' })).toBeInTheDocument();
  });
});
