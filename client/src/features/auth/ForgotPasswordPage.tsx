import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AuthCard, Button, ErrorText, Field } from '../../components/ui';
import { errorMessage, post } from '../../lib/api';

/** OTP password reset (FR-04): request a code, then set a new password with it. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<'request' | 'reset' | 'done'>('request');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (stage === 'request') {
        await post('/api/auth/password/forgot', { email });
        setStage('reset');
      } else {
        await post('/api/auth/password/reset', { email, code, password });
        setStage('done');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'done') {
    return (
      <AuthCard title="Password updated" subtitle="Sign in with your new password.">
        <Link to="/login" className="text-brand-500 hover:underline">
          Go to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle={
        stage === 'request'
          ? 'We will email you a 6-digit code.'
          : `If ${email} has an account, a code is on its way. It expires in 10 minutes.`
      }
      footer={
        <Link to="/login" className="hover:text-gray-200">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {stage === 'request' ? (
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        ) : (
          <>
            <Field
              label="Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 8 characters, with a letter and a number."
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} className="w-full">
          {stage === 'request' ? 'Send code' : 'Set new password'}
        </Button>
      </form>
    </AuthCard>
  );
}
