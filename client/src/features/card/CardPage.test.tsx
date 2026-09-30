import { act, fireEvent, screen } from '@testing-library/react';
import type { CardSceneProps } from './CardScene';
import { routes } from '../../app/router';
import { renderRoute } from '../../test/render';
import { approvedMemberRoutes, authUser, mockApi } from '../../test/mockApi';

// jsdom has no WebGL: stand in for the scene and expose its props.
let sceneProps: CardSceneProps | null = null;
vi.mock('./CardScene', () => ({
  CardScene: (p: CardSceneProps) => {
    sceneProps = p;
    return <div data-testid="scene" data-reveal={String(p.reveal)} data-tier={p.tier} />;
  },
}));
const save = vi.fn();
vi.mock('jspdf', () => ({
  jsPDF: class {
    addImage() {}
    addPage() {}
    save(name: string) {
      save(name);
    }
  },
}));

const card = (revealed: boolean) => ({
  name: 'Meera',
  libraryName: 'City Library',
  libraryInitial: 'C',
  logoUrl: null,
  cardColours: [],
  membershipNo: '4123456789012345',
  memberSince: '2026-01-01T00:00:00Z',
  validTill: '2026-12-31T00:00:00Z',
  tier: 'gold',
  status: 'active',
  qrToken: 'LV1.x',
  qrDataUrl: 'data:image/png;base64,AAAA',
  revealed,
});

beforeEach(() => {
  sceneProps = null;
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AA';
});

describe('3D card (FR-21)', () => {
  it('plays the reveal once on first activation, then records it', async () => {
    const calls = mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/member/card': { status: 200, body: card(false) },
      'POST /api/member/card/revealed': { status: 204 },
    });
    renderRoute(routes, '/member/card');
    const scene = await screen.findByTestId('scene', {}, { timeout: 5000 });
    expect(scene).toHaveAttribute('data-reveal', 'true');
    expect(scene).toHaveAttribute('data-tier', 'gold');

    act(() => sceneProps!.onRevealDone!());
    expect(await screen.findByText(/Drag to rotate/)).toBeInTheDocument();
    expect(screen.getByTestId('scene')).toHaveAttribute('data-reveal', 'false');
    expect(calls.some((c) => c.path === '/api/member/card/revealed')).toBe(true);
  });

  it('opens straight into rotate mode after the first time, and downloads a PDF', async () => {
    mockApi({
      ...approvedMemberRoutes,
      'GET /api/auth/me': { status: 200, body: { user: authUser('member') } },
      'GET /api/member/card': { status: 200, body: card(true) },
    });
    renderRoute(routes, '/member/card');
    expect(await screen.findByTestId('scene', {}, { timeout: 5000 })).toHaveAttribute(
      'data-reveal',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('libraverse-card-2345.pdf'));
  });
});
