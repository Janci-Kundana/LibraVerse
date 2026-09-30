import { fireEvent, screen } from '@testing-library/react';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { authUser, memberProfile, mockApi } from '../../test/mockApi';

describe('JoinPage (FR-02)', () => {
  it('finds a library, signs up with ID proof, and lands on "Verification pending"', async () => {
    const calls = mockApi({
      'GET /api/public/libraries': {
        status: 200,
        body: [{ name: 'City Library', slug: 'city', logoUrl: null }],
      },
      'GET /api/public/libraries/city': {
        status: 200,
        body: { name: 'City Library', slug: 'city', logoUrl: null },
      },
      'POST /api/members/join': { status: 201, body: { status: 'ok', user: authUser('member') } },
      'GET /api/member/profile': { status: 200, body: memberProfile('pending') },
    });
    renderRoute(routes, '/join');

    fireEvent.click(await screen.findByRole('button', { name: /City Library/ }));
    expect(await screen.findByRole('heading', { name: 'Join City Library' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Meera Nair' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'meera@x.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Meera-pass1' } });
    const id = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'id.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('ID proof'), { target: { files: [id] } });

    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    // The card photo is required.
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add a clear photo of your face for your card',
    );
    const face = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByLabelText('Card photo'), { target: { files: [face] } });
    fireEvent.click(submit);

    expect(
      await screen.findByRole('heading', { name: 'Verification pending' }),
    ).toBeInTheDocument();
    const join = calls.find((c) => c.path === '/api/members/join');
    expect(join?.body).toMatchObject({
      librarySlug: 'city',
      name: 'Meera Nair',
      acceptTerms: true,
      idProof: expect.stringMatching(/^data:image\/png;base64,/),
      photo: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });
});

describe('member home', () => {
  it('shows the rejection reason and lets the member upload again', async () => {
    const calls = mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/member/profile': { status: 200, body: memberProfile('rejected') },
      'POST /api/member/id-proof': { status: 200, body: memberProfile('pending') },
    });
    renderRoute(routes, '/member');
    expect(
      await screen.findByRole('heading', { name: 'ID proof not accepted' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: Photo is blurry')).toBeInTheDocument();

    const id = new File(['%PDF-1.4'], 'id.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('New ID proof'), { target: { files: [id] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload again' }));
    expect(
      await screen.findByRole('heading', { name: 'Verification pending' }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/member/id-proof')).toBe(true);
  });

  it('shows the membership number and plans once approved', async () => {
    mockApi({
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/member/profile': { status: 200, body: memberProfile('approved') },
      'GET /api/member/plans': {
        status: 200,
        body: [
          {
            id: 'p1',
            name: 'Gold',
            price: 49900,
            durationDays: 90,
            bookLimit: 4,
            finePerDay: 500,
            tier: 'gold',
            active: true,
          },
        ],
      },
    });
    renderRoute(routes, '/member');
    expect(await screen.findByText('4123 4567 8901 2345')).toBeInTheDocument();
    expect(await screen.findByText('₹499')).toBeInTheDocument();
  });
});
