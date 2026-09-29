import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginResponse, PublicLibraryDto } from '@libraverse/shared';
import { AuthCard, Button, ErrorText, Field } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';
import { readFileAsDataUrl } from '../../lib/format';
import { ME_KEY } from '../auth/useAuth';

const MAX_ID_BYTES = 5 * 1024 * 1024;

/** FR-02: a visitor joins a library and uploads ID proof. */
export function JoinPage() {
  const [params, setParams] = useSearchParams();
  const slug = params.get('library');
  const [q, setQ] = useState('');
  const libraries = useQuery({
    queryKey: ['public-libraries', q],
    queryFn: () => api<PublicLibraryDto[]>(`/api/public/libraries?q=${encodeURIComponent(q)}`),
    enabled: !slug,
  });
  const chosen = useQuery({
    queryKey: ['public-library', slug],
    queryFn: () => api<PublicLibraryDto>(`/api/public/libraries/${slug}`),
    enabled: !!slug,
  });

  if (!slug) {
    return (
      <AuthCard
        title="Join a library"
        subtitle="Find your library to become a member."
        footer={
          <>
            Already a member?{' '}
            <Link to="/login" className="text-brand-500 hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <Field
          label="Search libraries"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Library name"
        />
        <ul className="mt-4 space-y-2">
          {libraries.data?.map((l) => (
            <li key={l.slug}>
              <button
                type="button"
                onClick={() => setParams({ library: l.slug })}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-700 px-4 py-3 text-left hover:border-brand-500"
              >
                {l.logoUrl ? (
                  <img src={l.logoUrl} alt="" className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded bg-gray-800 font-semibold">
                    {l.name[0]}
                  </span>
                )}
                <span className="font-medium">{l.name}</span>
              </button>
            </li>
          ))}
          {libraries.data?.length === 0 && (
            <li className="text-sm text-gray-400">No libraries match.</li>
          )}
        </ul>
      </AuthCard>
    );
  }

  return (
    <JoinForm slug={slug} libraryName={chosen.data?.name ?? '…'} onBack={() => setParams({})} />
  );
}

function JoinForm({
  slug,
  libraryName,
  onBack,
}: {
  slug: string;
  libraryName: string;
  onBack: () => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [file, setFile] = useState<File | null>(null);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError('Upload a photo or PDF of your ID proof');
    if (file.size > MAX_ID_BYTES) return setError('ID proof must be under 5 MB');
    setError('');
    setBusy(true);
    try {
      const res = await post<LoginResponse>('/api/members/join', {
        librarySlug: slug,
        ...form,
        phone: form.phone || undefined,
        idProof: await readFileAsDataUrl(file),
        acceptTerms: accept,
      });
      if (res.status === 'ok') {
        qc.setQueryData(ME_KEY, res.user);
        navigate('/member', { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={`Join ${libraryName}`}
      subtitle="Staff check your ID before your membership can start."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Full name"
          autoComplete="name"
          required
          value={form.name}
          onChange={set('name')}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
        />
        <Field
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={set('phone')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          required
          value={form.password}
          onChange={set('password')}
        />
        <label className="block">
          <span className="text-sm text-gray-300">ID proof</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-label="ID proof"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-gray-300 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-800 file:px-3 file:py-2 file:text-gray-100"
          />
          <span className="mt-1 block text-xs text-gray-500">
            Aadhaar, college ID, driving licence… JPG, PNG, WebP or PDF, up to 5 MB. Only this
            library’s staff can see it.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            className="mt-1"
          />
          I accept the library’s rules, including late fines and care of borrowed books.
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" busy={busy} disabled={!accept} className="w-full">
          Create account
        </Button>
      </form>
      <button
        type="button"
        onClick={onBack}
        className="mt-4 text-sm text-gray-400 hover:text-gray-200"
      >
        Choose a different library
      </button>
    </AuthCard>
  );
}
