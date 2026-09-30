import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LibrarySettingsDto } from '@libraverse/shared';
import { PageSkeleton, Button, Card, ErrorText, Field, PageHeader } from '../../components/ui';
import { api, errorMessage, put } from '../../lib/api';
import { readFileAsDataUrl, toPaise } from '../../lib/format';
import { ME_KEY } from '../auth/useAuth';

const SETTINGS_KEY = ['library', 'settings'] as const;

/** FR-08: branding shown on the member card and across the library's pages. */
export function SettingsPage() {
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api<LibrarySettingsDto>('/api/library/settings'),
  });
  if (!settings.data) return <PageSkeleton />;
  return <SettingsForm settings={settings.data} />;
}

function SettingsForm({ settings: s }: { settings: LibrarySettingsDto }) {
  const qc = useQueryClient();
  const [name, setName] = useState(s.name);
  const [colours, setColours] = useState(
    s.cardColours.length ? s.cardColours : ['#c0263a', '#111827'],
  );
  const [logo, setLogo] = useState<File | null>(null);
  const [circ, setCirc] = useState({
    loanDays: String(s.circulation.loanDays),
    maxRenewals: String(s.circulation.maxRenewals),
    holdDays: String(s.circulation.holdDays),
    lostBookCharge: String(s.circulation.lostBookCharge / 100),
    depositAmount: String(s.circulation.depositAmount / 100),
    warningIntervalDays: String(s.circulation.warningIntervalDays),
    deductionGraceDays: String(s.circulation.deductionGraceDays),
  });

  const save = useMutation({
    mutationFn: async () =>
      put<LibrarySettingsDto>('/api/library/settings', {
        name,
        cardColours: colours,
        circulation: {
          loanDays: Number(circ.loanDays),
          maxRenewals: Number(circ.maxRenewals),
          holdDays: Number(circ.holdDays),
          lostBookCharge: toPaise(circ.lostBookCharge),
          depositAmount: toPaise(circ.depositAmount),
          warningIntervalDays: Number(circ.warningIntervalDays),
          deductionGraceDays: Number(circ.deductionGraceDays),
        },
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
      <PageHeader title="Library settings" icon="settings" />
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
                  className="h-10 w-14 rounded border border-white/10 bg-white/[0.035]"
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm text-gray-300">Security deposit and unpaid dues</legend>
            <Field
              label="Deposit (₹, same for every member)"
              type="number"
              min="1"
              step="0.01"
              required
              value={circ.depositAmount}
              onChange={(e) => setCirc({ ...circ, depositAmount: e.target.value })}
            />
            <Field
              label="Days between due reminders"
              type="number"
              min="1"
              max="30"
              value={circ.warningIntervalDays}
              onChange={(e) => setCirc({ ...circ, warningIntervalDays: e.target.value })}
            />
            <Field
              label="Days after 3rd reminder to deduct"
              type="number"
              min="2"
              max="60"
              value={circ.deductionGraceDays}
              onChange={(e) => setCirc({ ...circ, deductionGraceDays: e.target.value })}
            />
            <p className="text-xs text-gray-500 sm:col-span-3">
              Collected with each member’s first membership. Dues left unpaid after three reminders
              are deducted from it (never below ₹0); if it runs out while dues remain, the card is
              blocked until they are paid.
            </p>
          </fieldset>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm text-gray-300">Borrowing rules</legend>
            <Field
              label="Loan period (days)"
              type="number"
              min="1"
              max="180"
              value={circ.loanDays}
              onChange={(e) => setCirc({ ...circ, loanDays: e.target.value })}
            />
            <Field
              label="Renewals allowed"
              type="number"
              min="0"
              max="10"
              value={circ.maxRenewals}
              onChange={(e) => setCirc({ ...circ, maxRenewals: e.target.value })}
            />
            <Field
              label="Reservation hold (days)"
              type="number"
              min="1"
              max="30"
              value={circ.holdDays}
              onChange={(e) => setCirc({ ...circ, holdDays: e.target.value })}
            />
            <Field
              label="Lost book charge (₹)"
              type="number"
              min="0"
              step="0.01"
              value={circ.lostBookCharge}
              onChange={(e) => setCirc({ ...circ, lostBookCharge: e.target.value })}
            />
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
