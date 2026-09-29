import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { Link } from 'react-router';

/** Centered card used by the sign-in, sign-up and password pages. */
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
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-950 px-4 py-12 text-gray-100">
      <Link to="/" className="mb-8 text-2xl font-bold tracking-tight">
        Libra<span className="text-brand-500">Verse</span>
      </Link>
      <section className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 sm:p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </section>
      {footer && <div className="mt-6 text-sm text-gray-400">{footer}</div>}
    </main>
  );
}

export function Field({
  label,
  hint,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const hintId = useId();
  return (
    <div>
      <label className="block">
        <span className="text-sm text-gray-300">{label}</span>
        <input
          {...input}
          aria-describedby={hint ? hintId : undefined}
          className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none placeholder:text-gray-600 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
      </label>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-gray-500">
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
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const styles = {
    primary: 'bg-brand-500 text-white hover:bg-brand-600',
    secondary: 'border border-gray-700 text-gray-200 hover:bg-gray-800',
    danger: 'border border-red-900 text-red-300 hover:bg-red-950',
  }[variant];
  return (
    <button
      {...props}
      disabled={busy || props.disabled}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ''}`}
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300"
    >
      {children}
    </p>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-gray-800 bg-gray-900 p-4 sm:p-5 ${className}`}>
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
      <span className="text-sm text-gray-300">{label}</span>
      <select
        {...select}
        className="mt-1 block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-brand-500"
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
    green: 'bg-emerald-950 text-emerald-300',
    yellow: 'bg-yellow-950 text-yellow-300',
    red: 'bg-red-950 text-red-300',
    gray: 'bg-gray-800 text-gray-400',
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${styles}`}>{children}</span>
  );
}
