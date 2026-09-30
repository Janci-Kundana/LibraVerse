import { REVEAL_SECONDS, SETTLED, revealPose } from './reveal';

describe('card reveal timeline', () => {
  it('starts below the screen behind a fading overlay', () => {
    const p = revealPose(0);
    expect(p).toMatchObject({ y: -4, overlay: 0, done: false });
    expect(revealPose(0.8).overlay).toBeCloseTo(1);
  });

  it('spins fast while rising, then settles at the resting tilt with a light sweep', () => {
    expect(Math.abs(revealPose(1.2).rotY)).toBeGreaterThan(Math.PI);
    expect(revealPose(4).sweep).not.toBeNull();
    const end = revealPose(REVEAL_SECONDS);
    expect(end).toMatchObject({ done: true, overlay: 0, sweep: 1 });
    expect(end.rotY).toBeCloseTo(SETTLED.rotY);
    expect(end.y).toBeCloseTo(0);
  });
});
