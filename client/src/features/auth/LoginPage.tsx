import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  homePathFor,
  type AuthUser,
  type LibraryChoice,
  type LoginResponse,
} from '@libraverse/shared';
import { AuthCard, Button, ErrorText, Field } from '../../components/ui';
import { ApiRequestError, errorMessage, post } from '../../lib/api';
import { ME_KEY } from './useAuth';

const ROLE_LABELS = {
  superAdmin: 'Platform admin',
  libraryAdmin: 'Library admin',
  librarian: 'Librarian',
  member: 'Member',
} as const;

type Step =
  | { kind: 'credentials' }
  | { kind: 'chooseLibrary'; choices: LibraryChoice[] }
  | { kind: 'otp'; challengeToken: string };

/** One login page for every role (FR-04); each role lands on its own dashboard. */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  function finish(user: AuthUser) {
    qc.setQueryData(ME_KEY, user);
    const next = params.get('next');
    const home = homePathFor(user.role);
    // Only follow ?next= within the user's own area.
    navigate(next?.startsWith(home) ? next : home, { replace: true });
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'LIBRARY_CHOICE_REQUIRED') {
        setStep({ kind: 'chooseLibrary', choices: err.details as LibraryChoice[] });
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  const signIn = (libraryId?: string | null) =>
    run(async () => {
      const res = await post<LoginResponse>('/api/auth/login', { email, password, libraryId });
      if (res.status === 'twoFactorRequired') {
        setStep({ kind: 'otp', challengeToken: res.challengeToken });
      } else {
        finish(res.user);
      }
    });

  const verifyCode = (challengeToken: string) =>
    run(async () => {
      const res = await post<LoginResponse>('/api/auth/login/otp', { challengeToken, code });
      if (res.status === 'ok') finish(res.user);
    });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind === 'otp') void verifyCode(step.challengeToken);
    else void signIn();
  };

  if (step.kind === 'chooseLibrary') {
    return (
      <AuthCard
        title="Choose a library"
        subtitle="This email has accounts in more than one library."
      >
        <ul className="space-y-2">
          {step.choices.map((c) => (
            <li key={c.libraryId ?? 'platform'}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void signIn(c.libraryId)}
                className="w-full rounded-lg border border-gray-700 px-4 py-3 text-left hover:border-brand-500 disabled:opacity-50"
              >
                <span className="block font-medium">{c.libraryName}</span>
                <span className="text-sm text-gray-400">{ROLE_LABELS[c.role]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <ErrorText>{error}</ErrorText>
        </div>
        <button
          type="button"
          onClick={() => setStep({ kind: 'credentials' })}
          className="mt-4 text-sm text-gray-400 hover:text-gray-200"
        >
          Back
        </button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={step.kind === 'otp' ? 'Enter your sign-in code' : 'Sign in'}
      subtitle={
        step.kind === 'otp'
          ? `We emailed a 6-digit code to ${email}.`
          : 'Staff, members and platform admins all sign in here.'
      }
      footer={
        <>
          New library?{' '}
          <Link to="/register-library" className="text-brand-500 hover:underline">
            Register it
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {step.kind === 'otp' ? (
          <Field
            label="Sign-in code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        ) : (
          <>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} className="w-full">
          {step.kind === 'otp' ? 'Verify' : 'Sign in'}
        </Button>
      </form>
      {step.kind === 'credentials' && (
        <Link
          to="/forgot-password"
          className="mt-4 inline-block text-sm text-gray-400 hover:text-gray-200"
        >
          Forgot password?
        </Link>
      )}
    </AuthCard>
  );
}
