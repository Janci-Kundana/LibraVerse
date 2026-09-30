import { useEffect, useState } from 'react';
import type { MemberCardDto } from '@libraverse/shared';
import { renderFaces } from './cardFaces';

type Faces = { front: HTMLCanvasElement; back: HTMLCanvasElement };

/**
 * Draws both card faces, including the member's private profile photo, which
 * is fetched with their session (same origin) so it never taints the canvas.
 */
export function useCardFaces(card: MemberCardDto | undefined) {
  const [faces, setFaces] = useState<Faces | null>(null);
  useEffect(() => {
    if (!card) return;
    let alive = true;
    let photoUrl: string | null = null;
    void (async () => {
      if (card.hasPhoto) {
        const res = await fetch('/api/member/photo', { credentials: 'include' }).catch(() => null);
        if (res?.ok) photoUrl = URL.createObjectURL(await res.blob());
      }
      const f = await renderFaces(card, photoUrl);
      if (alive) setFaces(f);
    })();
    return () => {
      alive = false;
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [card]);
  return faces;
}
