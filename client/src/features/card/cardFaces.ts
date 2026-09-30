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

export function drawFront(ctx: CanvasRenderingContext2D, card: MemberCardDto) {
  const f = FINISHES[card.tier];
  background(ctx, f);
  // Giant monogram of the library's first letter, unique per library.
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = f.ink;
  ctx.font = 'bold 620px Georgia, serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(card.libraryInitial, FACE_W - 470, FACE_H + 70);
  ctx.restore();

  ctx.fillStyle = f.ink;
  ctx.font = '600 44px Inter, system-ui, sans-serif';
  ctx.fillText(card.libraryName.slice(0, 30), 60, 92);
  ctx.fillStyle = f.muted;
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.fillText('LIBRAVERSE MEMBERSHIP', 60, 128);

  chip(ctx, 64, 230);

  ctx.fillStyle = f.ink;
  ctx.font = '600 34px Inter, system-ui, sans-serif';
  ctx.fillText(card.name.toUpperCase().slice(0, 26), 60, FACE_H - 70);

  // Tier badge
  ctx.font = 'bold 26px Inter, system-ui, sans-serif';
  const label = f.label;
  const w = ctx.measureText(label).width + 44;
  ctx.strokeStyle = f.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(FACE_W - w - 56, FACE_H - 112, w, 52, 26);
  ctx.stroke();
  ctx.fillText(label, FACE_W - w - 34, FACE_H - 77);
}

export function drawBack(
  ctx: CanvasRenderingContext2D,
  card: MemberCardDto,
  qr: CanvasImageSource | null,
) {
  const f = FINISHES[card.tier];
  background(ctx, f);
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 56, FACE_W, 96); // magnetic stripe

  // Signature strip
  ctx.fillStyle = '#f5f5f4';
  ctx.fillRect(60, 190, 480, 64);
  ctx.fillStyle = '#44403c';
  ctx.font = 'italic 30px "Brush Script MT", cursive';
  ctx.fillText(card.name.slice(0, 26), 76, 234);

  // Embossed 16-digit number: a light and a dark offset give depth.
  ctx.font = '600 50px "Courier New", monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(groups(card.membershipNo), 58, 338);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(groups(card.membershipNo), 62, 342);
  ctx.fillStyle = f.ink;
  ctx.fillText(groups(card.membershipNo), 60, 340);

  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillStyle = f.muted;
  ctx.fillText('VALID THRU', 60, 400);
  ctx.fillText('MEMBER ID', 300, 400);
  ctx.font = '600 34px "Courier New", monospace';
  ctx.fillStyle = f.ink;
  ctx.fillText(validThru(card.validTill), 60, 440);
  ctx.fillText(card.membershipNo.slice(-8), 300, 440);

  // Library crest
  ctx.beginPath();
  ctx.arc(112, 540, 44, 0, Math.PI * 2);
  ctx.strokeStyle = f.ink;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = 'bold 48px Georgia, serif';
  ctx.fillStyle = f.ink;
  ctx.fillText(card.libraryInitial, 96, 557);
  ctx.font = '500 20px Inter, system-ui, sans-serif';
  ctx.fillText(card.libraryName.slice(0, 28), 176, 548);

  // QR scanned at the counter, on a white quiet zone.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(FACE_W - 330, 190, 270, 270, 18);
  ctx.fill();
  if (qr) ctx.drawImage(qr, FACE_W - 315, 205, 240, 240);
  ctx.font = '500 18px Inter, system-ui, sans-serif';
  ctx.fillStyle = f.muted;
  ctx.fillText('Scan at the counter', FACE_W - 300, 500);
}

/** Resolves to null if the image fails or never loads, so the card still renders. */
function loadImage(src: string, timeoutMs = 3000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
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
export async function renderFaces(card: MemberCardDto) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = FACE_W;
    c.height = FACE_H;
    return c;
  };
  const front = make();
  const back = make();
  const qr = await loadImage(card.qrDataUrl);
  const fctx = front.getContext?.('2d');
  const bctx = back.getContext?.('2d');
  if (fctx) drawFront(fctx, card);
  if (bctx) drawBack(bctx, card, qr);
  return { front, back };
}
