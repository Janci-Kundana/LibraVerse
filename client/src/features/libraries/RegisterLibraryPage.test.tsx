import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { mockApi } from '../../test/mockApi';

const plans = [
  { id: 'p1', code: 'free', name: 'Free', monthlyPrice: 0, memberLimit: 100, branchLimit: 1 },
  { id: 'p2', code: 'pro', name: 'Pro', monthlyPrice: 99900, memberLimit: null, branchLimit: 10 },
];

describe('RegisterLibraryPage', () => {
  it('registers on the Free plan and explains what happens next', async () => {
    const calls = mockApi({
      'GET /api/platform-plans': { status: 200, body: plans },
      'POST /api/libraries/register': {
        status: 201,
        body: { id: 'l1', slug: 'city', status: 'pending' },
      },
    });
    renderRoute(routes, '/register-library');
    expect(await screen.findByText('₹999/month')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Library name'), { target: { value: 'City Library' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } });
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'asha@city.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register library' }));

    expect(
      await screen.findByRole('heading', { name: 'Registration received' }),
    ).toBeInTheDocument();
    expect(calls.at(-1)?.body).toEqual({
      libraryName: 'City Library',
      ownerName: 'Asha Rao',
      ownerEmail: 'asha@city.test',
      planCode: 'free',
    });
  });
});
