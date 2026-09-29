import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: response.ok,
    status: response.status,
    statusText: '',
    json: async () => response.body,
  } as Response);
}

describe('LandingPage', () => {
  it('shows the API as healthy when /api/health succeeds', async () => {
    mockFetch({ ok: true, status: 200, body: { status: 'ok', db: 'connected', uptimeSeconds: 1 } });
    renderRoute(routes, '/');
    expect(screen.getByRole('heading', { name: /libraverse/i })).toBeInTheDocument();
    expect(await screen.findByText(/API ok · database connected/)).toBeInTheDocument();
  });

  it('shows the API as unreachable when the request fails', async () => {
    mockFetch({ ok: false, status: 500, body: { error: { code: 'X', message: 'boom' } } });
    renderRoute(routes, '/');
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });

  it('renders the 404 page for unknown routes', () => {
    renderRoute(routes, '/nowhere');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
