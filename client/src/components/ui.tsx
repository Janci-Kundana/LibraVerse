import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { Link } from 'react-router';
import { Aurora } from './Aurora';
import { Icon, LogoMark, type IconName } from './icons';

/** The wordmark, used in headers and auth pages. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight ${className}`}
    >
      <LogoMark />
      <span>
        Libra<span className="text-gradient">Verse</span>
      </span>
    </span>
  );
}

const AUTH_POINTS: { icon: IconName; text: string }[] = [
  { icon: 'card', text: 'A 3D membership card in your pocket' },
  { icon: 'zap', text: 'Pay online and see it confirmed instantly' },
  { icon: 'qr', text: 'Two quick scans to borrow a book' },
];

/**
 * Sign-in, sign-up and password pages: a showcase panel on large screens and
 * a frosted form card.
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <Aurora />
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-white/5 p-12 lg:flex">
        <Link to="/">
          <Wordmark />
        </Link>
        <div>
          <h2 className="max-w-md text-4xl font-bold leading-tight">
            Your library, <span className="text-gradient">beautifully digital.</span>
          </h2>
          <ul className="mt-8 space-y-4">
            {AUTH_POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-gray-300">
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-gold-300">
                  <Icon name={p.icon} className="h-4.5 w-4.5" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <MiniCard className="mx-auto w-80 animate-float" />
      </aside>

      <div className="flex flex-col items-center justify-center px-4 py-12">
        <Link to="/" className="mb-8 lg:hidden">
          <Wordmark />
        </Link>
        <section className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-gray-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </section>
        {footer && <div className="mt-6 text-sm text-gray-400">{footer}</div>}
      </div>
    </main>
  );
}

/** A decorative Gold-tier card drawn in CSS (for marketing panels). */
export function MiniCard({
  className = '',
  name = 'Meera Nair',
  tier = 'GOLD',
}: {
  className?: string;
  name?: string;
  tier?: string;
}) {
  return (
    <div
      aria-hidden
      className={`relative aspect-[1.586] overflow-hidden rounded-2xl bg-gradient-to-br from-gold-200 via-gold-400 to-gold-500 p-5 text-[#3b2a10] shadow-[0_30px_80px_-20px_rgb(200_155_60/0.55)] [transform:rotate(-6deg)] ${className}`}
    >
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,transparent_0_6px,rgb(255_255_255/0.08)_6px_7px)]" />
      <div className="absolute -right-6 -bottom-16 font-serif text-[11rem] font-bold leading-none opacity-15">
        L
      </div>
      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-[0.2em]">LIBRAVERSE</span>
          <span className="rounded-full border border-[#3b2a10]/60 px-2 py-0.5 text-[10px] font-bold">
            {tier}
          </span>
        </div>
        <div className="h-8 w-11 rounded-md bg-gradient-to-br from-gold-200 to-gold-500 shadow-inner ring-1 ring-[#3b2a10]/30" />
        <div>
          <p className="font-mono text-sm tracking-[0.2em]">4217 8630 9152 6374</p>
          <p className="mt-1 text-sm font-semibold tracking-wide">{name.toUpperCase()}</p>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  'mt-1.5 block w-full rounded-xl border border-white/10 bg-white/[0.035] px-3.5 py-2.5 text-gray-100 outline-none transition placeholder:text-gray-600 hover:border-white/20 focus:border-brand-400/70 focus:bg-white/[0.05] focus:ring-4 focus:ring-brand-500/15';

export function Field({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const hintId = useId();
  return (
    <div>
      <label className="block">
        <span className="text-sm font-medium text-gray-300">{label}</span>
        <input {...input} aria-describedby={hint ? hintId : undefined} className={inputClass} />
      </label>
      {hint && (
        <p id={hintId} className="mt-1.5 text-xs text-gray-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function Button({
  busy,
  variant = 'primary',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'gold';
}) {
  const styles = {
    primary:
      'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_8px_28px_-8px_rgb(226_41_74/0.8)] hover:shadow-[0_10px_34px_-6px_rgb(226_41_74/0.9)] hover:brightness-110',
    gold: 'bg-gradient-to-r from-gold-300 to-gold-500 text-[#2a1d06] shadow-[0_8px_28px_-8px_rgb(226_187_102/0.7)] hover:brightness-110',
    secondary:
      'border border-white/12 bg-white/[0.04] text-gray-100 hover:border-white/25 hover:bg-white/[0.08]',
    danger:
      'border border-red-500/30 bg-red-500/[0.06] text-red-300 hover:border-red-400/60 hover:bg-red-500/15',
  }[variant];
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-45 ${styles} ${props.className ?? ''}`}
    >
      {busy && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.08] px-3.5 py-2.5 text-sm text-red-200"
    >
      <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
      <span>{children}</span>
    </p>
  );
}

export function PageHeader({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3.5">
        {icon && (
          <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-brand-500/25 to-gold-500/10 text-brand-300">
            <Icon name={icon} className="h-5 w-5" />
          </span>
        )}
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  /** lift and glow on hover */
  interactive?: boolean;
}) {
  return (
    <section
      className={`glass rounded-2xl p-4 sm:p-5 ${
        interactive
          ? 'transition duration-300 hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_24px_60px_-30px_rgb(226_41_74/0.5)]'
          : ''
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function SelectField({
  label,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-300">{label}</span>
      <select
        {...select}
        className={`${inputClass} appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa3bd' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")] bg-[length:1.1rem] bg-[right_0.8rem_center] bg-no-repeat pr-10 [&>option]:bg-[#0d1120]`}
      >
        {children}
      </select>
    </label>
  );
}

export function StatusPill({
  tone,
  children,
}: {
  tone: 'green' | 'yellow' | 'red' | 'gray';
  children: ReactNode;
}) {
  const styles = {
    green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
    yellow: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    red: 'border-red-400/30 bg-red-500/10 text-red-300',
    gray: 'border-white/10 bg-white/5 text-gray-400',
  }[tone];
  const dot = {
    green: 'bg-emerald-400',
    yellow: 'bg-amber-300',
    red: 'bg-red-400',
    gray: 'bg-gray-500',
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium first-letter:uppercase ${styles}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** Shimmering placeholder while a page loads. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-4">
      <div className="skeleton h-9 w-56" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
        <div className="skeleton h-24" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-16" />
      ))}
    </div>
  );
}

/** Friendly empty state with an icon. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center rounded-2xl px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-500/20 to-gold-500/10 text-brand-300">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-4 font-medium text-gray-200">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-gray-400">{children}</div>}
    </div>
  );
}
