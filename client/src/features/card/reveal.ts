// The one-time reveal (report §"3D Virtual Membership Card"), as a pure
// function of elapsed seconds so it can be tested:
//   0.0–0.8 s  screen fades to black, a crimson glow rises
//   0.8–2.4 s  card shoots up from below, spinning fast across several axes
//   2.4–3.6 s  slows and drifts in a gentle vertical loop
//   3.6–4.4 s  settles at a tilt while light sweeps across the chip
//   4.4 s      done: "Drag to rotate" appears

export const REVEAL_SECONDS = 4.4;

export interface RevealPose {
  y: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  overlay: number; // 0..1 black overlay
  glow: number; // 0..1 crimson glow
  sweep: number | null; // light position across the card, -1..1, or null
  done: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;
const easeInOut = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2);

export const SETTLED = { rotX: -0.12, rotY: 0.35, rotZ: 0.04 };

export function revealPose(t: number): RevealPose {
  const fade = clamp01(t / 0.8);
  const rise = clamp01((t - 0.8) / 1.6);
  const drift = clamp01((t - 2.4) / 1.2);
  const settle = clamp01((t - 3.6) / 0.8);

  // Spin: many turns while rising, decaying to rest (front facing = multiples of 2π).
  const spinY = (1 - easeOut(rise)) * Math.PI * 6;
  const spinX = (1 - easeOut(rise)) * Math.PI * 4;
  const y = rise < 1 ? -4 + easeOut(rise) * 4 : Math.sin(drift * Math.PI * 2) * 0.12 * (1 - settle);

  return {
    y,
    rotX: spinX + easeInOut(settle) * SETTLED.rotX,
    rotY: spinY + easeInOut(settle) * SETTLED.rotY,
    rotZ: Math.sin(rise * Math.PI) * 0.6 + easeInOut(settle) * SETTLED.rotZ,
    overlay: t < 0.8 ? fade : 1 - clamp01((t - 3.6) / 0.8),
    glow: t < 0.8 ? fade : 1 - settle,
    sweep: t >= 3.6 && t <= 4.4 ? -1 + 2 * settle : null,
    done: t >= REVEAL_SECONDS,
  };
}
