import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, mockApi } from '../../test/mockApi';

function fillAndSubmit(email = 'sam@x.test', password = 'Readers4ever') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it.each([
    ['librarian', 'Library dashboard'],
    ['member', 'Home'],
    ['superAdmin', 'Libraries'],
  ] as const)('routes a %s to their dashboard', async (role, heading) => {
    mockApi({
      'POST /api/auth/login': { status: 200, body: { status: 'ok', user: authUser(role) } },
      'GET /api/admin/libraries?status=pending': { status: 200, body: [] },
    });
    renderRoute(routes, '/login');
    fillAndSubmit();
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it('shows the server error for bad credentials', async () => {
    mockApi({
      'POST /api/auth/login': {
        status: 401,
        body: { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
      },
    });
    renderRoute(routes, '/login');
    fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('asks which library when the email has several, then signs into the chosen one', async () => {
    const calls = mockApi({
      'POST /api/auth/login': (body) =>
        (body as { libraryId?: string }).libraryId
          ? { status: 200, body: { status: 'ok', user: authUser('member') } }
          : {
              status: 409,
              body: {
                error: {
                  code: 'LIBRARY_CHOICE_REQUIRED',
                  message: 'Choose one',
                  details: [
                    { libraryId: 'lib1', libraryName: 'City Library', role: 'member' },
                    { libraryId: 'lib2', libraryName: 'College Library', role: 'librarian' },
                  ],
                },
              },
            },
    });
    renderRoute(routes, '/login');
    fillAndSubmit();
    fireEvent.click(await screen.findByRole('button', { name: /City Library/ }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(calls.at(-1)?.body).toMatchObject({ email: 'sam@x.test', libraryId: 'lib1' });
  });

  it('asks staff with two-factor on for the emailed code', async () => {
    const calls = mockApi({
      'POST /api/auth/login': {
        status: 200,
        body: { status: 'twoFactorRequired', challengeToken: 'ch1' },
      },
      'POST /api/auth/login/otp': {
        status: 200,
        body: { status: 'ok', user: authUser('libraryAdmin') },
      },
    });
    renderRoute(routes, '/login');
    fillAndSubmit();
    fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: 'Library dashboard' })).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({ challengeToken: 'ch1', code: '123456' });
  });
});
