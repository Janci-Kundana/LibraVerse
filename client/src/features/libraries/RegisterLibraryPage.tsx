import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PlatformPlanDto } from '@libraverse/shared';
import { AuthCard, Button, ErrorText, Field } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';

const rupees = (paise: number) =>
  paise === 0 ? 'Free' : `₹${(paise / 100).toLocaleString('en-IN')}/month`;

/** FR-01: a library owner registers; the Super Admin approves before it goes live. */
export function RegisterLibraryPage() {
  const plans = useQuery({
    queryKey: ['platform-plans'],
    queryFn: () => api<PlatformPlanDto[]>('/api/platform-plans'),
  });
  const [form, setForm] = useState({ libraryName: '', ownerName: '', ownerEmail: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await post('/api/libraries/register', { ...form, planCode: 'free' });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard
        title="Registration received"
        subtitle={`We will email ${form.ownerEmail} a link to set your password once ${form.libraryName} is approved.`}
      >
        <Link to="/" className="text-brand-500 hover:underline">
          Back to home
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Register your library"
      subtitle="Get your own LibraVerse workspace. We review every library before it goes live."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="text-brand-500 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Library name"
          required
          value={form.libraryName}
          onChange={set('libraryName')}
        />
        <Field
          label="Your name"
          autoComplete="name"
          required
          value={form.ownerName}
          onChange={set('ownerName')}
        />
        <Field
          label="Your email"
          type="email"
          autoComplete="email"
          required
          value={form.ownerEmail}
          onChange={set('ownerEmail')}
        />

        <fieldset>
          <legend className="text-sm text-gray-300">Plan</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(plans.data ?? []).map((p) => {
              const available = p.code === 'free';
              return (
                <label
                  key={p.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${available ? 'border-brand-500' : 'border-gray-800 opacity-60'}`}
                >
                  <input
                    type="radio"
                    name="plan"
                    className="sr-only"
                    checked={available}
                    disabled={!available}
                    readOnly
                  />
                  <span className="block font-medium">{p.name}</span>
                  <span className="text-gray-400">{rupees(p.monthlyPrice)}</span>
                  <span className="block text-xs text-gray-500">
                    {p.memberLimit ? `Up to ${p.memberLimit} members` : 'Unlimited members'} ·{' '}
                    {p.branchLimit === 1 ? '1 branch' : `${p.branchLimit ?? 'Unlimited'} branches`}
                  </span>
                  {!available && (
                    <span className="block text-xs text-gray-500">Upgrade after approval</span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} className="w-full">
          Register library
        </Button>
      </form>
    </AuthCard>
  );
}
