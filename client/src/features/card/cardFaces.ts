import type { CardTier, MemberCardDto } from '@libraverse/shared';

// Card faces are drawn on 2D canvases (ISO ID-1 ratio). The same canvases
// become Three.js textures and the pages of the downloadable PDF.

export const FACE_W = 1012;
export const FACE_H = 638;

interface Finish {
  from: string;
  to: string;
  ink: string;
  muted: string;
  edge: string;
  label: string;
}

/** Tier finishes: silver, champagne gold, crimson, black metal. */
export const FINISHES: Record<CardTier, Finish> = {
  member: {
    from: '#e4e7eb',
    to: '#9aa1ab',
    ink: '#1f2937',
    muted: '#4b5563',
    edge: '#b8bec6',
    label: 'MEMBER',
  },
  gold: {
    from: '#f3e3b8',
    to: '#b8955a',
    ink: '#3b2a10',
    muted: '#6b5530',
    edge: '#cfb27a',
    label: 'GOLD',
  },
  premium: {
    from: '#c0263a',
    to: '#4a0d17',
    ink: '#fdf2f3',
    muted: '#f3c2c9',
    edge: '#8b1022',
    label: 'PREMIUM',
  },
  elite: {
    from: '#2b2b2e',
    to: '#050506',
    ink: '#f5f5f4',
    muted: '#a8a29e',
    edge: '#1a1a1c',
    label: 'ELITE',
  },
};

function background(ctx: CanvasRenderingContext2D, f: Finish) {
  const g = ctx.createLinearGradient(0, 0, FACE_W, FACE_H);
  g.addColorStop(0, f.from);
  g.addColorStop(1, f.to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  // Brushed-metal lines.
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#ffffff';
  for (let y = 0; y < FACE_H; y += 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(FACE_W, y + 12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const g = ctx.createLinearGradient(x, y, x + 120, y + 90);
  g.addColorStop(0, '#f7e3a1');
  g.addColorStop(0.5, '#c9a24a');
  g.addColorStop(1, '#f1d98a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, 120, 90, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,60,20,0.55)';
  ctx.lineWidth = 2;
  for (const dx of [40, 80]) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y);
    ctx.lineTo(x + dx, y + 90);
    ctx.stroke();
  }
  for (const dy of [30, 60]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy);
    ctx.lineTo(x + 120, y + dy);
    ctx.stroke();
  }
}

const groups = (no: string) => no.replace(/(\d{4})(?=\d)/g, '$1  ');

const validThru = (iso: string | null) => {
  if (!iso) return '--/--';
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
};

/** Rounded-rectangle clip for an image (photo, logo). */
function clipImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  // cover-fit
  const iw = (img as HTMLImageElement).naturalWidth || w;
  const ih = (img as HTMLImageElement).naturalHeight || h;
  const scale = Math.max(w / iw, h / ih);
  ctx.drawImage(img, x + (w - iw * scale) / 2, y + (h - ih * scale) / 2, iw * scale, ih * scale);
  ctx.restore();
}

export interface FaceImages {
  qr: CanvasImageSource | null;
  photo: CanvasImageSource | null;
  logo: CanvasImageSource | null;
}

/**
 * FRONT: card holder's name and photo, the QR the librarian scans, and the
 * library's branding (tier finish, chip, monogram, tier badge).
 */
export function drawFront(ctx: CanvasRenderingContext2D, card: MemberCardDto, img: FaceImages) {
  const f = FINISHES[card.tier];
  background(ctx, f);
  // Giant monogram of the library's first letter, unique per library.
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = f.ink;
  ctx.font = 'bold 560px Georgia, serif';
  ctx.fillText(card.libraryInitial, 330, FACE_H + 60);
  ctx.restore();

  ctx.fillStyle = f.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText('MEMBERSHIP CARD', 60, 78);
  ctx.fillStyle = f.ink;
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  ctx.fillText(card.libraryName.slice(0, 32), 60, 116);

  // Photo
  const px = 60;
  const py = 170;
  const pw = 200;
  const ph = 250;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.roundRect(px - 4, py - 4, pw + 8, ph + 8, 22);
  ctx.fill();
  if (img.photo) clipImage(ctx, img.photo, px, py, pw, ph, 18);
  else {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 18);
    ctx.fill();
    ctx.fillStyle = f.ink;
    ctx.font = 'bold 110px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(card.name.trim()[0]?.toUpperCase() ?? '?', px + pw / 2, py + ph / 2 + 38);
    ctx.textAlign = 'left';
  }

  chip(ctx, 300, 180);

  ctx.fillStyle = f.muted;
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText('CARD HOLDER', 300, 330);
  ctx.fillStyle = f.ink;
  ctx.font = '700 38px Inter, system-ui, sans-serif';
  const name = card.name.toUpperCase();
  ctx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, 300, 376);
  ctx.fillStyle = f.muted;
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText(`VALID THRU ${validThru(card.validTill)}`, 300, 414);

  // QR the librarian scans (ids + signature only; details are fetched on scan).
  const qx = FACE_W - 300;
  const qy = 150;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(qx, qy, 240, 240, 18);
  ctx.fill();
  if (img.qr) ctx.drawImage(img.qr, qx + 14, qy + 14, 212, 212);
  else drawPlaceholderQr(ctx, qx + 20, qy + 20, 200);
  ctx.fillStyle = f.muted;
  ctx.font = '500 18px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Scan at the counter', qx + 120, qy + 272);
  ctx.textAlign = 'left';

  // Tier badge
  ctx.fillStyle = f.ink;
  ctx.font = 'bold 24px Inter, system-ui, sans-serif';
  const label = f.label;
  const w = ctx.measureText(label).width + 40;
  ctx.strokeStyle = f.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(60, FACE_H - 110, w, 48, 24);
  ctx.stroke();
  ctx.fillText(label, 80, FACE_H - 77);
}

/** BACK: card number, library logo and the library's name. */
export function drawBack(ctx: CanvasRenderingContext2D, card: MemberCardDto, img: FaceImages) {
  const f = FINISHES[card.tier];
  background(ctx, f);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 56, FACE_W, 90); // magnetic stripe

  // Library logo (or its monogram) and name
  const lx = 60;
  const ly = 190;
  if (img.logo) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(lx, ly, 130, 130, 24);
    ctx.fill();
    clipImage(ctx, img.logo, lx + 8, ly + 8, 114, 114, 18);
  } else {
    ctx.beginPath();
    ctx.arc(lx + 65, ly + 65, 62, 0, Math.PI * 2);
    ctx.strokeStyle = f.ink;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = 'bold 72px Georgia, serif';
    ctx.fillStyle = f.ink;
    ctx.textAlign = 'center';
    ctx.fillText(card.libraryInitial, lx + 65, ly + 90);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = f.muted;
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText('ISSUED BY', 230, 232);
  ctx.fillStyle = f.ink;
  ctx.font = '700 40px Inter, system-ui, sans-serif';
  ctx.fillText(card.libraryName.slice(0, 26), 230, 282);

  // Embossed 16-digit card number: a light and a dark offset give depth.
  ctx.fillStyle = f.muted;
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText('CARD NUMBER', 60, 400);
  ctx.font = '600 56px "Courier New", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(groups(card.membershipNo), 58, 458);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(groups(card.membershipNo), 62, 462);
  ctx.fillStyle = f.ink;
  ctx.fillText(groups(card.membershipNo), 60, 460);

  // Signature strip and the member-since line
  ctx.fillStyle = '#f5f5f4';
  ctx.fillRect(60, 510, 420, 56);
  ctx.fillStyle = '#44403c';
  ctx.font = 'italic 28px "Brush Script MT", cursive';
  ctx.fillText(card.name.slice(0, 26), 76, 548);
  ctx.fillStyle = f.muted;
  ctx.font = '500 18px Inter, system-ui, sans-serif';
  ctx.fillText(
    `MEMBER SINCE ${new Date(card.memberSince).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }).toUpperCase()}`,
    520,
    546,
  );
}

function loadImage(src: string, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    // Cross-origin logos (e.g. Cloudinary) must not taint the canvas used as a texture.
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/** Both faces as canvases; drawing is skipped where canvas is unavailable (tests). */
/** Both faces as canvases; drawing is skipped where canvas is unavailable (tests). */
export async function renderFaces(card: MemberCardDto, photoSrc: string | null = null) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = FACE_W;
    c.height = FACE_H;
    return c;
  };
  const front = make();
  const back = make();
  const [qr, photo, logo] = await Promise.all([
    loadImage(card.qrDataUrl),
    photoSrc ? loadImage(photoSrc) : Promise.resolve(null),
    card.logoUrl ? loadImage(card.logoUrl) : Promise.resolve(null),
  ]);
  const images = { qr, photo, logo };
  const fctx = front.getContext?.('2d');
  const bctx = back.getContext?.('2d');
  if (fctx) drawFront(fctx, card, images);
  if (bctx) drawBack(bctx, card, images);
  return { front, back };
}

/** A decorative QR-like pattern for demo cards that have no real token. */
function drawPlaceholderQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const n = 25;
  const cell = size / n;
  ctx.fillStyle = '#0b0f1e';
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const finder = (cx: number, cy: number) => (cx >= 0 && cx < 7 && cy >= 0 && cy < 7 ? 1 : 0);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const inFinder = finder(c, r) || finder(c - (n - 7), r) || finder(c, r - (n - 7));
      if (inFinder) continue;
      if (r < 8 && (c < 8 || c > n - 9)) continue;
      if (r > n - 9 && c < 8) continue;
      if (rand() > 0.52) ctx.fillRect(x + c * cell, y + r * cell, cell, cell);
    }
  }
  for (const [fx, fy] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ] as const) {
    ctx.fillRect(x + fx * cell, y + fy * cell, 7 * cell, 7 * cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + (fx + 1) * cell, y + (fy + 1) * cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#0b0f1e';
    ctx.fillRect(x + (fx + 2) * cell, y + (fy + 2) * cell, 3 * cell, 3 * cell);
  }
}
