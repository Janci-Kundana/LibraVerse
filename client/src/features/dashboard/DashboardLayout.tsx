import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { isStaff, type Role } from '@libraverse/shared';
import { useLogout, useMe } from '../auth/useAuth';
import { NotificationBell } from './NotificationBell';
import { MembershipCelebration } from '../card/Celebration';

interface NavItem {
  to: string;
  label: string;
}

// Each role's sidebar grows as later phases add pages.
const NAV: Record<Role, NavItem[]> = {
  superAdmin: [
    { to: '/admin', label: 'Libraries' },
    { to: '/admin/analytics', label: 'Analytics' },
    { to: '/admin/plans', label: 'Plans' },
    { to: '/admin/security', label: 'Security' },
  ],
  libraryAdmin: [
    { to: '/library', label: 'Dashboard' },
    { to: '/library/counter', label: 'Counter' },
    { to: '/library/loans', label: 'Loans' },
    { to: '/library/members', label: 'Members' },
    { to: '/library/deposit-refunds', label: 'Deposit refunds' },
    { to: '/library/payments', label: 'Payments' },
    { to: '/library/reservations', label: 'Reservations' },
    { to: '/library/verifications', label: 'ID verification' },
    { to: '/library/catalog', label: 'Catalog' },
    { to: '/library/donations', label: 'Donations' },
    { to: '/library/events', label: 'Events & notices' },
    { to: '/library/plans', label: 'Plans & coupons' },
    { to: '/library/branches', label: 'Branches' },
    { to: '/library/staff', label: 'Staff' },
    { to: '/library/settings', label: 'Settings' },
    { to: '/library/payment-settings', label: 'Online payments' },
    { to: '/library/subscription', label: 'Subscription' },
    { to: '/library/audit', label: 'Audit log' },
    { to: '/library/security', label: 'Security' },
  ],
  librarian: [
    { to: '/library', label: 'Dashboard' },
    { to: '/library/counter', label: 'Counter' },
    { to: '/library/loans', label: 'Loans' },
    { to: '/library/members', label: 'Members' },
    { to: '/library/deposit-refunds', label: 'Deposit refunds' },
    { to: '/library/reservations', label: 'Reservations' },
    { to: '/library/verifications', label: 'ID verification' },
    { to: '/library/catalog', label: 'Catalog' },
    { to: '/library/donations', label: 'Donations' },
    { to: '/library/events', label: 'Events & notices' },
    { to: '/library/security', label: 'Security' },
  ],
  member: [
    { to: '/member', label: 'Home' },
    { to: '/member/card', label: 'My card' },
    { to: '/member/loans', label: 'My books' },
    { to: '/member/payments', label: 'Payments' },
    { to: '/member/events', label: 'Notice board' },
    { to: '/member/assistant', label: 'Ask the library' },
    { to: '/member/catalog', label: 'Catalog' },
    { to: '/member/wishlist', label: 'Wishlist' },
  ],
};

const ROLE_TITLES: Record<Role, string> = {
  superAdmin: 'Platform admin',
  libraryAdmin: 'Library admin',
  librarian: 'Librarian',
  member: 'Member',
};

export function DashboardLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  if (!user) return null;

  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login') });

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 md:flex">
      <aside className="border-b border-gray-800 md:min-h-screen md:w-60 md:border-r md:border-b-0">
        <div className="px-4 py-4">
          <p className="text-lg font-bold">
            Libra<span className="text-brand-500">Verse</span>
          </p>
          <p className="truncate text-sm text-gray-400">{user.libraryName ?? 'Platform'}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:pb-0">
          {NAV[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/library' || item.to === '/member' || item.to === '/admin'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-100'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3 md:px-8">
          <p className="min-w-0 truncate text-sm text-gray-300">
            {user.name} · <span className="text-gray-500">{ROLE_TITLES[user.role]}</span>
          </p>
          <div className="flex items-center gap-3">
            {user.libraryId && <NotificationBell />}
            <button onClick={signOut} className="text-sm text-gray-400 hover:text-gray-100">
              Sign out
            </button>
          </div>
        </header>
        <main className="px-4 py-6 md:px-8">
          <Outlet />
          {user.role === 'member' && <MembershipCelebration />}
        </main>
      </div>
    </div>
  );
}

export function HomeShell({ title, children }: { title: string; children?: ReactNode }) {
  const { data: user } = useMe();
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-gray-400">
        Welcome, {user?.name}.
        {user && isStaff(user.role) && user.libraryName
          ? ` You are signed in to ${user.libraryName}.`
          : ''}
      </p>
      {children}
    </div>
  );
}
