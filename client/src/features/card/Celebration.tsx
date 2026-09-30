import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CelebrationDto, MemberCardDto } from '@libraverse/shared';
import { Button } from '../../components/ui';
import { api, post } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';
import { useCardFaces } from './useCardFaces';

const CONFETTI_COLOURS = ['#c0263a', '#f3e3b8', '#fdf2f3', '#f59e0b', '#10b981', '#60a5fa'];

function makePieces() {
  return Array.from({ length: 90 }, (_, i) => {
    const angle = (i / 90) * Math.PI * 2 + Math.random() * 0.3;
    const dist = 180 + Math.random() * 320;
    return {
      id: i,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist - 80,
      rotate: Math.random() * 720 - 360,
      delay: Math.random() * 0.25,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      w: 6 + Math.random() * 8,
      h: 8 + Math.random() * 10,
    };
  });
}

/** A burst of confetti pieces flying out from behind the card. */
function Confetti() {
  // Random once per burst (a lazy initialiser, not during every render).
  const [pieces] = useState(makePieces);
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute rounded-sm"
          style={{ width: p.w, height: p.h, background: p.colour }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: p.x, y: [p.y, p.y + 260], opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: 2.6, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/**
 * Shown once after a confirmed membership payment (online, UPI QR or cash):
 * the member's card with a confetti burst and the new plan details. The server
 * only offers it for a successful payment.
 */
export function MembershipCelebration() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [side, setSide] = useState<'front' | 'back'>('front');
  const celebration = useQuery({
    queryKey: ['member', 'celebration'],
    queryFn: () => api<{ celebration: CelebrationDto | null }>('/api/member/celebration'),
    retry: false,
    refetchInterval: 15_000,
  });
  const c = celebration.data?.celebration ?? null;
  const card = useQuery({
    queryKey: ['member', 'card'],
    queryFn: () => api<MemberCardDto>('/api/member/card'),
    enabled: c != null,
  });
  const faces = useCardFaces(c ? card.data : undefined);
  const seen = useMutation({
    mutationFn: () => post(`/api/member/celebration/${c!.paymentId}/seen`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['member'] }),
  });

  const close = (then?: string) => {
    seen.mutate();
    if (then) navigate(then);
  };

  return (
    <AnimatePresence>
      {c && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="celebration-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/85 px-4 py-8 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="relative w-full max-w-lg text-center">
            <Confetti />
            <motion.h2
              id="celebration-title"
              className="text-2xl font-bold text-white sm:text-3xl"
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              {c.startsAt
                ? `Thank you! ${c.planName} starts on ${formatDate(c.startsAt)}`
                : c.renewal
                  ? 'Congratulations! Your membership is renewed!'
                  : 'Congratulations! Your membership is active!'}
            </motion.h2>

            <motion.button
              type="button"
              aria-label={`Membership card, ${side} side. Tap to flip.`}
              onClick={() => setSide(side === 'front' ? 'back' : 'front')}
              className="relative mx-auto mt-6 block w-full max-w-md [perspective:1200px]"
              initial={{ scale: 0.4, rotate: -12, y: 120, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 12 }}
            >
              <motion.div
                className="relative aspect-[1012/638] w-full [transform-style:preserve-3d]"
                animate={{ rotateY: side === 'front' ? 0 : 180 }}
                transition={{ duration: 0.6 }}
              >
                {faces ? (
                  <>
                    <img
                      src={faces.front.toDataURL()}
                      alt="Card front"
                      className="absolute inset-0 h-full w-full rounded-2xl shadow-2xl [backface-visibility:hidden]"
                    />
                    <img
                      src={faces.back.toDataURL()}
                      alt="Card back"
                      className="absolute inset-0 h-full w-full rounded-2xl shadow-2xl [backface-visibility:hidden] [transform:rotateY(180deg)]"
                    />
                  </>
                ) : (
                  <div className="absolute inset-0 animate-pulse rounded-2xl bg-gradient-to-br from-brand-900 to-gray-900" />
                )}
              </motion.div>
            </motion.button>
            <p className="mt-2 text-xs text-gray-400">Tap the card to flip it</p>

            <dl className="mx-auto mt-5 grid max-w-md grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-left text-sm">
              <div>
                <dt className="text-gray-400">Plan</dt>
                <dd className="font-medium text-white">{c.planName}</dd>
              </div>
              {c.startsAt ? (
                <div>
                  <dt className="text-gray-400">Starts</dt>
                  <dd className="font-medium text-white">{formatDate(c.startsAt)}</dd>
                </div>
              ) : (
                <div>
                  <dt className="text-gray-400">Card tier</dt>
                  <dd className="font-medium capitalize text-white">{c.tier}</dd>
                </div>
              )}
              <div>
                <dt className="text-gray-400">Valid till</dt>
                <dd className="font-medium text-white">{formatDate(c.validTill)}</dd>
              </div>
              <div>
                <dt className="text-gray-400">Paid</dt>
                <dd className="font-medium text-white">{rupees(c.amount)}</dd>
              </div>
              {c.depositCollected > 0 && (
                <div className="col-span-2">
                  <dt className="text-gray-400">Security deposit included</dt>
                  <dd className="font-medium text-white">
                    {rupees(c.depositCollected)} (refundable)
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={() => close('/member/card')}>View my card</Button>
              <Button variant="secondary" onClick={() => close()}>
                Close
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
