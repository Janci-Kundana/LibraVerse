import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AuthCard, Button, ErrorText, Field } from '../../components/ui';
import { errorMessage, post } from '../../lib/api';

/** Target of the emailed set-password link (FR-01). */
export function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await post<{ email: string }>('/api/auth/password/setup', { token, password });
      setDoneFor(res.email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthCard title="Link incomplete" subtitle="Open the link from your email again.">
        <Link to="/login" className="text-brand-500 hover:underline">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  if (doneFor) {
    return (
      <AuthCard title="Password set" subtitle={`You can now sign in as ${doneFor}.`}>
        <Link to="/login" className="text-brand-500 hover:underline">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Set your password" subtitle="Choose the password for your LibraVerse account.">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} className="w-full">
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
