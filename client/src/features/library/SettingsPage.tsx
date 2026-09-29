import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LibrarySettingsDto } from '@libraverse/shared';
import { Button, Card, ErrorText, Field, PageHeader } from '../../components/ui';
import { api, errorMessage, put } from '../../lib/api';
import { readFileAsDataUrl } from '../../lib/format';
import { ME_KEY } from '../auth/useAuth';

const SETTINGS_KEY = ['library', 'settings'] as const;

/** FR-08: branding shown on the member card and across the library's pages. */
export function SettingsPage() {
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<LibrarySettingsDto>('/api/library/settings'),
  });
  if (!settings.data) return <p className="text-gray-400">Loading…</p>;
  return <SettingsForm settings={settings.data} />;
}

function SettingsForm({ settings: s }: { settings: LibrarySettingsDto }) {
  const qc = useQueryClient();
  const [name, setName] = useState(s.name);
  const [colours, setColours] = useState(
    s.cardColours.length ? s.cardColours : ['#c0263a', '#111827'],
  );
  const [logo, setLogo] = useState<File | null>(null);

  const save = useMutation({
    mutationFn: async () =>
      put<LibrarySettingsDto>('/api/library/settings', {
        name,
        cardColours: colours,
        ...(logo ? { logo: await readFileAsDataUrl(logo) } : {}),
      }),
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
      setLogo(null);
      return qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Library settings" />
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            label="Library name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <span className="text-sm text-gray-300">Logo</span>
            <div className="mt-1 flex items-center gap-3">
              {s.logoUrl ? (
                <img
                  src={s.logoUrl}
                  alt="Current logo"
                  className="h-12 w-12 rounded object-cover"
                />
              ) : (
                <span className="grid h-12 w-12 place-items-center rounded bg-gray-800 text-lg font-semibold">
                  {s.name[0]}
                </span>
              )}
              <input
                type="file"
                aria-label="Logo"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
                className="text-sm text-gray-300"
              />
            </div>
          </div>
          <fieldset>
            <legend className="text-sm text-gray-300">Card colours</legend>
            <div className="mt-1 flex gap-3">
              {colours.map((c, i) => (
                <input
                  key={i}
                  type="color"
                  aria-label={`Card colour ${i + 1}`}
                  value={c}
                  onChange={(e) =>
                    setColours((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  className="h-10 w-14 rounded border border-gray-700 bg-gray-950"
                />
              ))}
            </div>
          </fieldset>
          <p className="text-sm text-gray-500">
            Web address: /{s.slug} · Plan: {s.planCode ?? '—'} · Branches allowed:{' '}
            {s.branchLimit ?? 'unlimited'}
          </p>
          <ErrorText>{save.error ? errorMessage(save.error) : ''}</ErrorText>
          <Button type="submit" busy={save.isPending}>
            Save
          </Button>
          {save.isSuccess && <span className="ml-3 text-sm text-emerald-400">Saved</span>}
        </form>
      </Card>
    </div>
  );
}
