import { renderHook, waitFor } from '@testing-library/react';
import type { MemberCardDto } from '@libraverse/shared';
import { vi } from 'vitest';
import { renderFaces } from './cardFaces';
import { useCardFaces } from './useCardFaces';

vi.mock('./cardFaces', () => ({
  renderFaces: vi.fn(async () => ({ front: {}, back: {} })),
}));

describe('card photo', () => {
  it('fetches the private photo without sending cookies to the storage redirect', async () => {
    // Cloudinary answers with "Access-Control-Allow-Origin: *", which browsers
    // reject for credentials: 'include'; same-origin keeps the photo loading.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['img'], { type: 'image/jpeg' })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const card = { hasPhoto: true } as MemberCardDto;
    const { result } = renderHook(() => useCardFaces(card));
    await waitFor(() => expect(result.current).not.toBeNull());

    expect(fetchSpy).toHaveBeenCalledWith('/api/member/photo', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(renderFaces).toHaveBeenCalledWith(card, 'blob:photo');
  });
});
