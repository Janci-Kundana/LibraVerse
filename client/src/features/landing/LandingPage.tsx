import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import type { MemberCardDto } from '@libraverse/shared';
import { Aurora } from '../../components/Aurora';
import { Icon, type IconName } from '../../components/icons';
import { MiniCard, Wordmark } from '../../components/ui';
import { renderFaces } from '../card/cardFaces';
import { useHealth } from './useHealth';

const CardScene = lazy(() => import('../card/CardScene').then((m) => ({ default: m.CardScene })));

const DEMO_CARD: MemberCardDto = {
  name: 'Meera Nair',
  libraryName: 'Riverside Reading Room',
  libraryInitial: 'R',
  logoUrl: null,
  cardColours: [],
  membershipNo: '4217863091526374',
  memberSince: '2026-01-01T00:00:00.000Z',
  validTill: '2027-06-30T00:00:00.000Z',
  tier: 'gold',
  status: 'active',
  qrToken: '',
  qrDataUrl: '',
  revealed: true,
  hasPhoto: false,
};

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext?.('webgl2') ?? c.getContext?.('webgl'));
  } catch {
    return false;
  }
}

/** The real 3D card where WebGL exists; a CSS card everywhere else. */
function HeroCard() {
  const [faces, setFaces] = useState<{ front: HTMLCanvasElement; back: HTMLCanvasElement } | null>(
    null,
  );
  const [gl] = useState(webglAvailable);
  useEffect(() => {
    if (!gl) return;
    let alive = true;
    void renderFaces(DEMO_CARD).then((f) => alive && setFaces(f));
    return () => {
      alive = false;
    };
  }, [gl]);
  if (!gl || !faces) return <MiniCard className="mx-auto w-[min(420px,85vw)] animate-float" />;
  return (
    <div className="h-[340px] w-full sm:h-[420px]">
      <Suspense fallback={<MiniCard className="mx-auto w-[min(420px,85vw)]" />}>
        <CardScene front={faces.front} back={faces.back} tier="gold" reveal={false} />
      </Suspense>
    </div>
  );
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'card',
    title: '3D membership card',
    text: 'A metallic, tiltable card with a signed QR. No plastic, nothing to lose.',
  },
  {
    icon: 'zap',
    title: 'Live payments',
    text: 'Pay online or scan a UPI QR at the counter. Both screens update the same second.',
  },
  {
    icon: 'scan',
    title: 'Two-scan issue',
    text: 'Scan the card, scan the book. Limits, fines and holds are checked for you.',
  },
  {
    icon: 'shieldCheck',
    title: 'Digital ID checks',
    text: 'Members upload ID proof; staff approve it before a membership starts.',
  },
  {
    icon: 'wallet',
    title: 'Fair dues & deposits',
    text: 'Friendly reminders first. Deposits cover dues only after fair warning, never below ₹0.',
  },
  {
    icon: 'library',
    title: 'Smart catalog',
    text: 'ISBN auto-fill, CSV import, QR stickers for every copy, reviews and wishlists.',
  },
  {
    icon: 'sparkles',
    title: 'AI library assistant',
    text: 'Members ask about books, rules and their fines, answered from your own catalog.',
  },
  {
    icon: 'chart',
    title: 'Live dashboards',
    text: 'Revenue, loans and overdue books at a glance, with Excel and PDF exports.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Register your library',
    text: 'Pick Free or Pro. We verify and approve you, usually within a day.',
  },
  {
    n: '02',
    title: 'Set up in minutes',
    text: 'Branding, plans, staff and your own Razorpay keys. Import your books by CSV.',
  },
  {
    n: '03',
    title: 'Members join from their phones',
    text: 'They upload ID, pay online and get their 3D card instantly.',
  },
];

const ROLES: { icon: IconName; who: string; text: string }[] = [
  {
    icon: 'userCog',
    who: 'Library owners',
    text: 'Branding, branches, staff, plans, payments, reports and a tamper-proof audit log.',
  },
  {
    icon: 'scan',
    who: 'Librarians',
    text: 'A fast counter: scan, issue, return, collect cash or UPI, verify IDs, manage holds.',
  },
  {
    icon: 'users',
    who: 'Members',
    text: 'Search and reserve books, pay fines and carry their card on their phone.',
  },
];

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-hidden text-gray-100">
      <Aurora />

      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <Link to="/" aria-label="LibraVerse home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link
            to="/join"
            className="hidden rounded-lg px-3 py-2 text-gray-300 hover:text-white sm:inline"
          >
            Join a library
          </Link>
          <Link
            to="/donate"
            className="hidden rounded-lg px-3 py-2 text-gray-300 hover:text-white sm:inline"
          >
            Donate a book
          </Link>
          <Link
            to="/login"
            className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 font-semibold hover:bg-white/10"
          >
            Sign in
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pt-8 pb-20 sm:px-8 lg:grid-cols-2 lg:pt-16">
        <div>
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-gold-200"
          >
            <Icon name="sparkles" className="h-3.5 w-3.5" /> Everything digital, except the books
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mt-5 text-5xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl"
          >
            <span className="sr-only">LibraVerse: </span>
            Your library, <span className="text-gradient">beautifully digital.</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="mt-6 max-w-xl text-lg text-gray-300"
          >
            Memberships, 3D cards, online payments, QR check-outs and live dashboards for any
            library, on one platform.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="mt-8 flex flex-wrap gap-3"
          >
            <Link
              to="/register-library"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-6 py-3 font-semibold text-white shadow-[0_10px_40px_-10px_rgb(226_41_74/0.9)] transition hover:-translate-y-0.5 hover:brightness-110"
            >
              Register your library <Icon name="arrowRight" className="h-4 w-4" />
            </Link>
            <Link
              to="/join"
              className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-6 py-3 font-semibold transition hover:-translate-y-0.5 hover:bg-white/10"
            >
              Join a library
            </Link>
          </motion.div>
          <div className="mt-10 flex flex-wrap gap-8 text-sm">
            {[
              ['2 scans', 'to issue a book'],
              ['< 2 s', 'payment confirmation'],
              ['0 paper', 'registers or receipts'],
            ].map(([big, small]) => (
              <div key={big}>
                <p className="font-[family-name:var(--font-display)] text-2xl font-bold text-white">
                  {big}
                </p>
                <p className="text-gray-400">{small}</p>
              </div>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="relative"
        >
          <div
            aria-hidden
            className="absolute inset-10 -z-10 rounded-full bg-[radial-gradient(closest-side,rgb(226_187_102/0.35),transparent)] blur-2xl"
          />
          <HeroCard />
          <p className="mt-2 text-center text-xs text-gray-500">Drag the card to spin it</p>
        </motion.div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="text-sm font-semibold text-brand-300">Why LibraVerse</p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Everything a modern library needs</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.05}>
              <div className="glass group h-full rounded-2xl p-5 transition duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-[0_24px_60px_-28px_rgb(226_41_74/0.55)]">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500/25 to-gold-500/15 text-brand-300 transition group-hover:scale-110">
                  <Icon name={f.icon} />
                </span>
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-gray-400">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <Reveal>
          <h2 className="text-center text-3xl font-bold sm:text-4xl">Live in three steps</h2>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <div className="relative h-full rounded-2xl border border-white/8 bg-gradient-to-b from-white/[0.05] to-transparent p-6">
                <p className="text-gradient font-[family-name:var(--font-display)] text-5xl font-bold">
                  {s.n}
                </p>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-gray-400">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Roles */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div className="grid gap-4 lg:grid-cols-3">
          {ROLES.map((r, i) => (
            <Reveal key={r.who} delay={i * 0.08}>
              <div className="glass h-full rounded-2xl p-6">
                <Icon name={r.icon} className="h-6 w-6 text-gold-300" />
                <h3 className="mt-4 text-xl font-semibold">For {r.who.toLowerCase()}</h3>
                <p className="mt-2 text-gray-400">{r.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Call to action */}
      <section className="mx-auto max-w-7xl px-5 pt-10 pb-24 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-600/40 via-midnight-800 to-gold-500/20 px-6 py-14 text-center sm:px-12">
            <div
              aria-hidden
              className="absolute -top-24 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-brand-500/30 blur-3xl"
            />
            <h2 className="relative text-3xl font-bold sm:text-4xl">
              Bring your library online today
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-gray-300">
              Start free. Upgrade to Pro when you grow.
            </p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link
                to="/register-library"
                className="rounded-xl bg-white px-6 py-3 font-semibold text-gray-950 transition hover:-translate-y-0.5"
              >
                Get started free
              </Link>
              <Link
                to="/login"
                className="rounded-xl border border-white/20 px-6 py-3 font-semibold transition hover:bg-white/10"
              >
                Sign in
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-gray-500 sm:px-8">
          <Wordmark className="text-base" />
          <div className="flex flex-wrap items-center gap-5">
            <Link to="/donate" className="hover:text-gray-300">
              Donate a book
            </Link>
            <Link to="/join" className="hover:text-gray-300">
              Join a library
            </Link>
            <ApiStatus />
          </div>
        </div>
      </footer>
    </div>
  );
}

function ApiStatus() {
  const { data, isPending, isError } = useHealth();

  let label = 'Checking API…';
  let dot = 'bg-yellow-400';
  if (isError) {
    label = 'API unreachable';
    dot = 'bg-red-500';
  } else if (data) {
    label = `API ok · database ${data.db}`;
    dot = data.db === 'connected' ? 'bg-emerald-400' : 'bg-yellow-400';
  }

  return (
    <p
      role="status"
      aria-busy={isPending}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-gray-400"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </p>
  );
}
