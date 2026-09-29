import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CARD_TIERS,
  type CardTier,
  type CouponDto,
  type MembershipPlanDto,
} from '@libraverse/shared';
import {
  Button,
  Card,
  ErrorText,
  Field,
  PageHeader,
  SelectField,
  StatusPill,
} from '../../components/ui';
import { api, errorMessage, post, put } from '../../lib/api';
import { formatDate, rupees, toPaise } from '../../lib/format';

const PLANS_KEY = ['library', 'membership-plans'] as const;
const COUPONS_KEY = ['library', 'coupons'] as const;

const EMPTY_PLAN = {
  name: '',
  price: '',
  durationDays: '30',
  bookLimit: '2',
  finePerDay: '5',
  tier: 'member' as CardTier,
};

/** FR-10: membership plans with fine per day, and coupons. */
export function PlansPage() {
  const qc = useQueryClient();
  const plans = useQuery({
    queryKey: PLANS_KEY,
    queryFn: () => api<MembershipPlanDto[]>('/api/membership-plans'),
  });
  const [form, setForm] = useState(EMPTY_PLAN);
  const [editing, setEditing] = useState<string | null>(null);

  const body = () => ({
    name: form.name,
    price: toPaise(form.price),
    durationDays: Number(form.durationDays),
    bookLimit: Number(form.bookLimit),
    finePerDay: toPaise(form.finePerDay),
    tier: form.tier,
  });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? put(`/api/membership-plans/${editing}`, body())
        : post('/api/membership-plans', body()),
    onSuccess: () => {
      setForm(EMPTY_PLAN);
      setEditing(null);
      return qc.invalidateQueries({ queryKey: PLANS_KEY });
    },
  });
  const toggle = useMutation({
    mutationFn: (p: MembershipPlanDto) => {
      const { id, ...rest } = p;
      return put(`/api/membership-plans/${id}`, { ...rest, active: !p.active });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PLANS_KEY }),
  });

  function edit(p: MembershipPlanDto) {
    setEditing(p.id);
    setForm({
      name: p.name,
      price: String(p.price / 100),
      durationDays: String(p.durationDays),
      bookLimit: String(p.bookLimit),
      finePerDay: String(p.finePerDay / 100),
      tier: p.tier,
    });
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="max-w-4xl">
      <PageHeader title="Membership plans" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plans.data?.map((p) => (
          <Card key={p.id}>
            <p className="font-medium">
              {p.name}{' '}
              <StatusPill tone={p.active ? 'green' : 'gray'}>
                {p.active ? 'active' : 'hidden'}
              </StatusPill>
            </p>
            <p className="text-2xl font-semibold">{rupees(p.price)}</p>
            <p className="text-sm text-gray-400">
              {p.durationDays} days · {p.bookLimit} books · {rupees(p.finePerDay)}/day late ·{' '}
              {p.tier} card
            </p>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => edit(p)}>
                Edit
              </Button>
              <Button variant="secondary" onClick={() => toggle.mutate(p)}>
                {p.active ? 'Hide' : 'Show'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <h2 className="font-medium">{editing ? 'Edit plan' : 'New plan'}</h2>
        <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Name" required value={form.name} onChange={set('name')} />
          <Field
            label="Price (₹)"
            type="number"
            min="0"
            step="0.01"
            required
            value={form.price}
            onChange={set('price')}
          />
          <Field
            label="Duration (days)"
            type="number"
            min="1"
            required
            value={form.durationDays}
            onChange={set('durationDays')}
          />
          <Field
            label="Books at a time"
            type="number"
            min="0"
            required
            value={form.bookLimit}
            onChange={set('bookLimit')}
          />
          <Field
            label="Fine per day (₹)"
            type="number"
            min="0"
            step="0.01"
            required
            value={form.finePerDay}
            onChange={set('finePerDay')}
          />
          <SelectField label="Card tier" value={form.tier} onChange={set('tier')}>
            {CARD_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" busy={save.isPending}>
              {editing ? 'Save plan' : 'Create plan'}
            </Button>
            {editing && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(null);
                  setForm(EMPTY_PLAN);
                }}
              >
                Cancel
              </Button>
            )}
          </div>
          <div className="sm:col-span-3">
            <ErrorText>{save.error ? errorMessage(save.error) : ''}</ErrorText>
          </div>
        </form>
      </Card>

      <Coupons />
    </div>
  );
}

function Coupons() {
  const qc = useQueryClient();
  const coupons = useQuery({
    queryKey: COUPONS_KEY,
    queryFn: () => api<CouponDto[]>('/api/coupons'),
  });
  const [form, setForm] = useState({ code: '', discountPercent: '10', validTill: '' });
  const add = useMutation({
    mutationFn: () =>
      post('/api/coupons', { ...form, discountPercent: Number(form.discountPercent) }),
    onSuccess: () => {
      setForm({ code: '', discountPercent: '10', validTill: '' });
      return qc.invalidateQueries({ queryKey: COUPONS_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/coupons/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: COUPONS_KEY }),
  });

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Coupons</h2>
      <ul className="mt-3 space-y-2">
        {coupons.data?.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between rounded-lg border border-gray-800 px-4 py-2"
          >
            <span>
              <span className="font-mono">{c.code}</span> · {c.discountPercent}% off · until{' '}
              {formatDate(c.validTill)}
            </span>
            <Button variant="danger" onClick={() => remove.mutate(c.id)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
        className="mt-3 grid gap-3 sm:grid-cols-4"
      >
        <Field
          label="Code"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
        />
        <Field
          label="Discount %"
          type="number"
          min="1"
          max="100"
          required
          value={form.discountPercent}
          onChange={(e) => setForm({ ...form, discountPercent: e.target.value })}
        />
        <Field
          label="Valid till"
          type="date"
          required
          value={form.validTill}
          onChange={(e) => setForm({ ...form, validTill: e.target.value })}
        />
        <div className="self-end">
          <Button type="submit" busy={add.isPending}>
            Add coupon
          </Button>
        </div>
        <div className="sm:col-span-4">
          <ErrorText>{add.error ? errorMessage(add.error) : ''}</ErrorText>
        </div>
      </form>
    </section>
  );
}
