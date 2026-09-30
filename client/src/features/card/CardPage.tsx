import { lazy, Suspense, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberCardDto } from '@libraverse/shared';
import { Button, ErrorText, PageHeader, StatusPill } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useCardFaces } from './useCardFaces';
import type { RevealPose } from './reveal';

const CardScene = lazy(() => import('./CardScene').then((m) => ({ default: m.CardScene })));

const STATUS_TONE = { active: 'green', expired: 'red', blocked: 'red' } as const;
const CARD_KEY = ['member', 'card'] as const;

/** FR-21: the 3D card, its one-time reveal, and a PDF download. */
export function CardPage() {
  const qc = useQueryClient();
  const card = useQuery({
    queryKey: CARD_KEY,
    queryFn: () => api<MemberCardDto>('/api/member/card'),
  });
  const faces = useCardFaces(card.data);
  const [pose, setPose] = useState<Pick<RevealPose, 'overlay' | 'glow'>>({ overlay: 0, glow: 0 });
  const [revealDone, setRevealDone] = useState(false);
  const revealed = useMutation({ mutationFn: () => post('/api/member/card/revealed') });
  // The reveal plays once, the first time an active card is shown.
  const revealing =
    !revealDone && !!card.data && !card.data.revealed && card.data.status === 'active';
  const hint = revealDone || !!card.data?.revealed;

  function finishReveal() {
    setRevealDone(true);
    setPose({ overlay: 0, glow: 0 });
    revealed.mutate(undefined, {
      onSuccess: () =>
        qc.setQueryData<MemberCardDto>(CARD_KEY, (c) => (c ? { ...c, revealed: true } : c)),
    });
  }

  async function download() {
    if (!faces || !card.data) return;
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [85.6, 53.98] });
    pdf.addImage(faces.front.toDataURL('image/png'), 'PNG', 0, 0, 85.6, 53.98);
    pdf.addPage([85.6, 53.98], 'landscape');
    pdf.addImage(faces.back.toDataURL('image/png'), 'PNG', 0, 0, 85.6, 53.98);
    pdf.save(`libraverse-card-${card.data.membershipNo.slice(-4)}.pdf`);
  }

  if (card.isError) return <ErrorText>{errorMessage(card.error)}</ErrorText>;
  if (!card.data || !faces) return <p className="text-gray-400">Loading your card…</p>;
  const c = card.data;

  return (
    <div className="max-w-3xl">
      <PageHeader title="My card" icon="card">
        <StatusPill tone={STATUS_TONE[c.status]}>{c.status}</StatusPill>
      </PageHeader>

      {/* Full-screen during the reveal: black fade with a crimson glow from below. */}
      <div className={revealing ? 'fixed inset-0 z-50' : 'relative h-[340px] sm:h-[420px]'}>
        {revealing && (
          <div aria-hidden className="absolute inset-0 bg-black" style={{ opacity: pose.overlay }}>
            <div
              className="absolute inset-x-0 bottom-0 h-2/3"
              style={{
                opacity: pose.glow,
                background:
                  'radial-gradient(ellipse at 50% 100%, rgba(192,38,58,0.75), transparent 70%)',
              }}
            />
          </div>
        )}
        <Suspense fallback={<p className="text-gray-400">Loading 3D…</p>}>
          <CardScene
            front={faces.front}
            back={faces.back}
            tier={c.tier}
            reveal={revealing}
            onRevealFrame={(p) => setPose({ overlay: p.overlay, glow: p.glow })}
            onRevealDone={finishReveal}
          />
        </Suspense>
        <AnimatePresence>
          {hint && !revealing && (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-sm text-gray-400"
            >
              Drag to rotate · double-tap to flip · tilt your phone
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {!revealing && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-400">
            {c.name} · {c.tier} tier · valid thru {formatDate(c.validTill)}
            {c.status === 'blocked' && ' · clear overdue books or fines to unblock'}
          </p>
          <Button variant="secondary" onClick={() => void download()}>
            Download PDF
          </Button>
        </div>
      )}
    </div>
  );
}
