import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BarChart, StatTile } from '../../components/BarChart';
import { Button, Card, Field, PageHeader, StatusPill } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate, rupees } from '../../lib/format';
import { useMe } from '../auth/useAuth';
import { HomeShell } from '../dashboard/DashboardLayout';

interface Dashboard {
  totals: {
    members: number;
    pendingVerifications: number;
    titles: number;
    copies: number;
    activeLoans: number;
    overdueLoans: number;
    revenueThisMonth: number;
    outstandingDues: number;
  };
  revenueByMonth: { month: string; value: number }[];
  loansByDay: { day: string; value: number }[];
  popularBooks: { id: string; title: string; borrows: number }[];
}

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
const compactRupees = (p: number) =>
  p >= 100_000_00
    ? `₹${(p / 100_000_00).toFixed(1)}L`
    : p >= 100_000
      ? `₹${(p / 100_000).toFixed(1)}k`
      : rupees(p);

/** /library: admins get the dashboard (FR-11); librarians get quick links. */
export function LibraryHome() {
  const { data: me } = useMe();
  if (me?.role !== 'libraryAdmin') {
    return (
      <HomeShell title="Library dashboard">
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <QuickLink to="/library/counter" label="Counter" hint="Issue, return, collect payments" />
          <QuickLink
            to="/library/verifications"
            label="ID verification"
            hint="Approve new members"
          />
          <QuickLink to="/library/catalog" label="Catalog" hint="Books, copies and QR stickers" />
        </div>
      </HomeShell>
    );
  }
  return <AdminDashboard />;
}

function QuickLink({ to, label, hint }: { to: string; label: string; hint: string }) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-gray-800 bg-gray-900 p-4 hover:border-brand-500"
    >
      <p className="font-medium">{label}</p>
      <p className="text-sm text-gray-400">{hint}</p>
    </Link>
  );
}

function AdminDashboard() {
  const d = useQuery({
    queryKey: ['library', 'dashboard'],
    queryFn: () => api<Dashboard>('/api/reports/dashboard'),
  });
  const [range, setRange] = useState(() => {
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    return { from: new Date(now - 30 * 86_400_000).toISOString().slice(0, 10), to: today, today };
  });
  const today = range.today;
  if (!d.data)
    return (
      <HomeShell title="Library dashboard">
        <p className="mt-4 text-gray-400">Loading…</p>
      </HomeShell>
    );
  const t = d.data.totals;
  const q = `from=${range.from}&to=${range.to}`;

  return (
    <HomeShell title="Library dashboard">
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Members" value={String(t.members)} />
        <StatTile
          label="Awaiting ID check"
          value={String(t.pendingVerifications)}
          tone={t.pendingVerifications ? 'warn' : undefined}
        />
        <StatTile label="On loan" value={String(t.activeLoans)} />
        <StatTile
          label="Overdue"
          value={String(t.overdueLoans)}
          tone={t.overdueLoans ? 'warn' : undefined}
        />
        <StatTile label="Titles / copies" value={`${t.titles} / ${t.copies}`} />
        <StatTile label="Revenue this month" value={rupees(t.revenueThisMonth)} />
        <StatTile
          label="Unpaid fines"
          value={rupees(t.outstandingDues)}
          tone={t.outstandingDues ? 'warn' : undefined}
        />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Revenue by month (net of refunds)"
          data={d.data.revenueByMonth.map((r) => ({ label: monthLabel(r.month), value: r.value }))}
          format={compactRupees}
        />
        <BarChart
          title="Books issued per day, last 30 days"
          data={d.data.loansByDay.map((r) => ({ label: r.day.slice(8), value: r.value }))}
          tickEvery={5}
        />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-medium">Most borrowed</h2>
          {d.data.popularBooks.length === 0 && (
            <p className="mt-2 text-sm text-gray-400">No loans yet.</p>
          )}
          <ol className="mt-2 space-y-1 text-sm">
            {d.data.popularBooks.map((b, i) => (
              <li key={b.id} className="flex justify-between gap-3">
                <span className="truncate">
                  {i + 1}. {b.title}
                </span>
                <span className="text-gray-400">{b.borrows}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <h2 className="font-medium">Export reports</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field
              label="From"
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
            <Field
              label="To"
              type="date"
              value={range.to}
              max={today}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {[
              ['payments', 'Payments'],
              ['loans', 'Loans'],
              ['overdue', 'Overdue now'],
            ].map(([type, label]) => (
              <li key={type} className="flex items-center justify-between">
                <span>{label}</span>
                <span className="flex gap-3">
                  <a
                    className="text-brand-500 hover:underline"
                    href={`/api/reports/${type}.xlsx?${q}`}
                  >
                    Excel
                  </a>
                  <a
                    className="text-brand-500 hover:underline"
                    href={`/api/reports/${type}.pdf?${q}`}
                  >
                    PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </HomeShell>
  );
}

interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  items: {
    seq: number;
    action: string;
    actorName: string;
    actorRole: string | null;
    target: { type: string; id: string };
    details: Record<string, unknown>;
    createdAt: string;
  }[];
}

/** FR-11: the append-only audit log, with a chain integrity check. */
export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ['library', 'audit', action, page],
    queryFn: () => api<AuditPage>(`/api/audit?action=${encodeURIComponent(action)}&page=${page}`),
  });
  const verify = useQuery({
    queryKey: ['library', 'audit', 'verify'],
    queryFn: () => api<{ intact: boolean; brokenAtSeq: number | null }>('/api/audit/verify'),
  });
  const pages = log.data ? Math.max(1, Math.ceil(log.data.total / log.data.pageSize)) : 1;
  return (
    <div className="max-w-5xl">
      <PageHeader title="Audit log">
        {verify.data && (
          <StatusPill tone={verify.data.intact ? 'green' : 'red'}>
            {verify.data.intact ? 'chain intact' : `tampered at #${verify.data.brokenAtSeq}`}
          </StatusPill>
        )}
      </PageHeader>
      <p className="mb-3 text-sm text-gray-400">
        Every payment, cash entry, approval, issue, return and refund. Entries cannot be edited or
        deleted.
      </p>
      <Field
        label="Filter by action"
        placeholder="e.g. payment, loan.issued"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="py-2 pr-3">#</th>
              <th className="pr-3">When</th>
              <th className="pr-3">Who</th>
              <th className="pr-3">Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {log.data?.items.map((e) => (
              <tr key={e.seq} className="align-top">
                <td className="py-2 pr-3 text-gray-500">{e.seq}</td>
                <td className="pr-3 whitespace-nowrap">
                  {formatDate(e.createdAt)}{' '}
                  {new Date(e.createdAt).toLocaleTimeString('en-IN', { timeStyle: 'short' })}
                </td>
                <td className="pr-3">{e.actorName}</td>
                <td className="pr-3 font-mono text-xs">{e.action}</td>
                <td className="break-all font-mono text-xs text-gray-400">
                  {JSON.stringify(e.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Newer
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Older
          </Button>
        </div>
      )}
    </div>
  );
}

interface PlatformDashboard {
  librariesByStatus: Record<string, number>;
  totalMembers: number;
  newLibrariesByMonth: { month: string; value: number }[];
  revenueByMonth: { month: string; value: number }[];
  topLibraries: { id: string; name: string; members: number }[];
}

/** FR-07: platform analytics; library-level totals only. */
export function PlatformAnalyticsPage() {
  const d = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api<PlatformDashboard>('/api/admin/reports/dashboard'),
  });
  if (!d.data) return <p className="text-gray-400">Loading…</p>;
  const s = d.data.librariesByStatus;
  return (
    <div className="max-w-5xl">
      <PageHeader title="Platform analytics" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active libraries" value={String(s.active ?? 0)} />
        <StatTile
          label="Awaiting approval"
          value={String(s.pending ?? 0)}
          tone={s.pending ? 'warn' : undefined}
        />
        <StatTile label="Suspended" value={String(s.suspended ?? 0)} />
        <StatTile label="Members (all libraries)" value={String(d.data.totalMembers)} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Subscription revenue by month"
          data={d.data.revenueByMonth.map((r) => ({ label: monthLabel(r.month), value: r.value }))}
          format={compactRupees}
        />
        <BarChart
          title="New library registrations by month"
          data={d.data.newLibrariesByMonth.map((r) => ({
            label: monthLabel(r.month),
            value: r.value,
          }))}
        />
      </div>
      <Card className="mt-6">
        <h2 className="font-medium">Largest libraries by members</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {d.data.topLibraries.map((l, i) => (
            <li key={l.id} className="flex justify-between">
              <span>
                {i + 1}. {l.name}
              </span>
              <span className="text-gray-400">{l.members}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
