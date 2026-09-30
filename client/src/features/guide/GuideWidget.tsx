import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { guideFor, isGuidePath, type Role } from '@libraverse/shared';
import { Icon } from '../../components/icons';
import { api, errorMessage, post } from '../../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS: Record<Role, string[]> = {
  member: ['How do I borrow a book?', 'Why is my card blocked?', 'How do I get my deposit back?'],
  librarian: [
    'How do I issue a book?',
    'How do I take a cash payment?',
    'What needs attention today?',
  ],
  libraryAdmin: [
    'How do I connect Razorpay?',
    'How do I add a librarian?',
    'What needs attention today?',
  ],
  superAdmin: ['How do I approve a library?', 'Where are the platform totals?'],
};

/** Renders the guide's reply: line breaks, **bold** and in-app links only. */
function RichText({
  text,
  role,
  onNavigate,
}: {
  text: string;
  role: Role;
  onNavigate: () => void;
}) {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[3]) parts.push(<strong key={m.index}>{m[3]}</strong>);
    else if (m[2]!.startsWith('/') && isGuidePath(role, m[2]!))
      parts.push(
        <Link
          key={m.index}
          to={m[2]!}
          onClick={onNavigate}
          className="font-medium text-brand-300 underline decoration-brand-400/40 underline-offset-2 hover:text-brand-200"
        >
          {m[1]}
        </Link>,
      );
    else parts.push(m[1]);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <span className="whitespace-pre-line">{parts}</span>;
}

/**
 * The in-app guide: a help button on every signed-in page. It shows how to use
 * the current page straight away, and (when the AI key is set) answers
 * questions with links to the right pages.
 */
export function GuideWidget({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const here = guideFor(role, pathname);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const status = useQuery({
    queryKey: ['guide', 'status'],
    queryFn: () => api<{ enabled: boolean }>('/api/guide/status'),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const ask = useMutation({
    mutationFn: (history: Msg[]) =>
      post<{ reply: string }>('/api/guide', { page: pathname, messages: history.slice(-20) }),
    onSuccess: (r) => setMessages((m) => [...m, { role: 'assistant', content: r.reply }]),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => endRef.current?.scrollIntoView?.({ block: 'end' }), [messages, ask.isPending]);

  function send(text: string) {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t }];
    setMessages(next);
    setDraft('');
    ask.mutate(next);
  }

  const aiOn = status.data?.enabled === true;

  return (
    <>
      <motion.button
        type="button"
        aria-label={open ? 'Close guide' : 'Open guide'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.95 }}
        className="fixed right-4 bottom-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-[0_12px_40px_-8px_rgb(226_41_74/0.8)] ring-1 ring-white/15 sm:right-6 sm:bottom-6"
      >
        <Icon name={open ? 'x' : 'sparkles'} className="h-6 w-6" />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="LibraVerse guide"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            className="fixed inset-x-3 bottom-22 z-40 flex max-h-[75dvh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0b0f1e]/95 shadow-[0_30px_90px_-20px_rgb(0_0_0/0.9)] backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[400px]"
          >
            <header className="relative overflow-hidden border-b border-white/8 px-5 py-4">
              <div
                aria-hidden
                className="absolute -top-16 -right-10 h-40 w-40 rounded-full bg-brand-500/25 blur-3xl"
              />
              <p className="relative flex items-center gap-2 font-[family-name:var(--font-display)] text-base font-semibold">
                <Icon name="sparkles" className="h-4.5 w-4.5 text-gold-300" />
                LibraVerse guide
              </p>
              <p className="relative mt-0.5 text-xs text-gray-400">
                {aiOn
                  ? 'Ask how to do anything in the app.'
                  : 'How to use this page, step by step.'}
              </p>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4" aria-live="polite">
              {here && (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-gray-500 uppercase">
                    On this page
                  </p>
                  <p className="mt-1 font-semibold">{here.title}</p>
                  <p className="mt-1 text-sm text-gray-400">{here.summary}</p>
                  <ol className="mt-3 space-y-2 text-sm text-gray-300">
                    {here.steps.map((s, i) => (
                      <li key={s} className="flex gap-2.5">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[11px] font-bold text-brand-300">
                          {i + 1}
                        </span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {aiOn && messages.length === 0 && (
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS[role].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 transition hover:border-brand-400/50 hover:text-white"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
                  <p
                    className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      m.role === 'user'
                        ? 'rounded-br-md bg-gradient-to-br from-brand-500 to-brand-600 text-white'
                        : 'rounded-bl-md border border-white/8 bg-white/[0.05] text-gray-100'
                    }`}
                  >
                    {m.role === 'assistant' ? (
                      <RichText text={m.content} role={role} onNavigate={() => setOpen(false)} />
                    ) : (
                      m.content
                    )}
                  </p>
                </div>
              ))}
              {ask.isPending && (
                <p className="flex items-center gap-1.5 text-sm text-gray-500" role="status">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:240ms]" />
                  <span className="sr-only">Thinking…</span>
                </p>
              )}
              {ask.error && (
                <p role="alert" className="text-sm text-red-300">
                  {errorMessage(ask.error)}
                </p>
              )}
              {status.data && !aiOn && (
                <p className="text-xs text-gray-500">
                  Chat answers are not switched on yet. Staff at the library can help with anything
                  else.
                </p>
              )}
              <div ref={endRef} />
            </div>

            {aiOn && (
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  send(draft);
                }}
                className="flex gap-2 border-t border-white/8 p-3"
              >
                <label className="flex-1">
                  <span className="sr-only">Ask the guide</span>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={2000}
                    placeholder="How do I…?"
                    className="block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm outline-none placeholder:text-gray-600 focus:border-brand-400/70 focus:ring-4 focus:ring-brand-500/15"
                  />
                </label>
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={!draft.trim() || ask.isPending}
                  className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white transition hover:brightness-110 disabled:opacity-40"
                >
                  <Icon name="arrowRight" className="h-4.5 w-4.5" />
                </button>
              </form>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
