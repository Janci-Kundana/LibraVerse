import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { isStaff, type Role } from '@libraverse/shared';
import { Aurora } from '../../components/Aurora';
import { Icon, type IconName } from '../../components/icons';
import { Wordmark } from '../../components/ui';
import { useLogout, useMe } from '../auth/useAuth';
import { MembershipCelebration } from '../card/Celebration';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}
interface NavGroup {
  title?: string;
  items: NavItem[];
}

const STAFF_CORE: NavGroup[] = [
  { items: [{ to: '/library', label: 'Dashboard', icon: 'home' }] },
  {
    title: 'Front desk',
    items: [
      { to: '/library/counter', label: 'Counter', icon: 'scan' },
      { to: '/library/loans', label: 'Loans', icon: 'repeat' },
      { to: '/library/reservations', label: 'Reservations', icon: 'bookmark' },
    ],
  },
  {
    title: 'Members',
    items: [
      { to: '/library/members', label: 'Members', icon: 'users' },
      { to: '/library/verifications', label: 'ID verification', icon: 'shieldCheck' },
      { to: '/library/deposit-refunds', label: 'Deposit refunds', icon: 'undo' },
    ],
  },
  {
    title: 'Collection',
    items: [
      { to: '/library/catalog', label: 'Catalog', icon: 'library' },
      { to: '/library/donations', label: 'Donations', icon: 'gift' },
      { to: '/library/events', label: 'Events & notices', icon: 'megaphone' },
    ],
  },
];

// Each role sees only the pages it may open (the server enforces the same).
const NAV: Record<Role, NavGroup[]> = {
  superAdmin: [
    {
      items: [
        { to: '/admin', label: 'Libraries', icon: 'library' },
        { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
        { to: '/admin/plans', label: 'Plans', icon: 'crown' },
      ],
    },
    { title: 'Account', items: [{ to: '/admin/security', label: 'Security', icon: 'lock' }] },
  ],
  libraryAdmin: [
    ...STAFF_CORE,
    {
      title: 'Money',
      items: [
        { to: '/library/payments', label: 'Payments', icon: 'wallet' },
        { to: '/library/plans', label: 'Plans & coupons', icon: 'tag' },
        { to: '/library/payment-settings', label: 'Online payments', icon: 'creditCard' },
        { to: '/library/subscription', label: 'Subscription', icon: 'crown' },
      ],
    },
    {
      title: 'Library',
      items: [
        { to: '/library/branches', label: 'Branches', icon: 'mapPin' },
        { to: '/library/staff', label: 'Staff', icon: 'userCog' },
        { to: '/library/settings', label: 'Settings', icon: 'settings' },
        { to: '/library/audit', label: 'Audit log', icon: 'scroll' },
        { to: '/library/security', label: 'Security', icon: 'lock' },
      ],
    },
  ],
  librarian: [
    ...STAFF_CORE,
    { title: 'Account', items: [{ to: '/library/security', label: 'Security', icon: 'lock' }] },
  ],
  member: [
    {
      items: [
        { to: '/member', label: 'Home', icon: 'home' },
        { to: '/member/card', label: 'My card', icon: 'card' },
        { to: '/member/loans', label: 'My books', icon: 'book' },
        { to: '/member/payments', label: 'Payments', icon: 'wallet' },
      ],
    },
    {
      title: 'Discover',
      items: [
        { to: '/member/catalog', label: 'Catalog', icon: 'library' },
        { to: '/member/wishlist', label: 'Wishlist', icon: 'heart' },
        { to: '/member/events', label: 'Notice board', icon: 'megaphone' },
        { to: '/member/assistant', label: 'Ask the library', icon: 'sparkles' },
      ],
    },
  ],
};

const ROLE_TITLES: Record<Role, string> = {
  superAdmin: 'Platform admin',
  libraryAdmin: 'Library admin',
  librarian: 'Librarian',
  member: 'Member',
};

const HOMES = new Set(['/library', '/member', '/admin']);

function Nav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  return (
    <nav className="space-y-5 px-3">
      {NAV[role].map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              {group.title}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={HOMES.has(item.to)}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-gradient-to-r from-brand-500/20 to-transparent text-white'
                        : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active"
                          className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-gradient-to-b from-brand-400 to-gold-400"
                        />
                      )}
                      <Icon
                        name={item.icon}
                        className={`h-[18px] w-[18px] ${isActive ? 'text-brand-300' : 'text-gray-500 group-hover:text-gray-300'}`}
                      />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function DashboardLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!user) return null;

  const signOut = () => logout.mutate(undefined, { onSettled: () => navigate('/login') });
  const home =
    user.role === 'superAdmin' ? '/admin' : user.role === 'member' ? '/member' : '/library';

  const userChip = (
    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-gold-500 text-sm font-bold text-white">
        {initials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">{user.name}</p>
        <p className="truncate text-xs text-gray-500">{ROLE_TITLES[user.role]}</p>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-dvh text-gray-100 md:flex">
      <Aurora />

      {/* Desktop sidebar */}
      <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 flex-col rounded-none border-y-0 border-l-0 md:flex">
        <Link to={home} className="px-6 pt-6 pb-2">
          <Wordmark />
        </Link>
        <p className="truncate px-6 pb-5 text-xs text-gray-500">{user.libraryName ?? 'Platform'}</p>
        <div className="flex-1 overflow-y-auto pb-4">
          <Nav role={user.role} />
        </div>
        <div className="p-3">{userChip}</div>
      </aside>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              aria-label="Menu"
              className="glass fixed inset-y-0 left-0 z-50 flex w-72 flex-col rounded-none md:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="flex items-center justify-between px-5 pt-5 pb-4">
                <Wordmark />
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5"
                >
                  <Icon name="x" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto pb-4">
                <Nav role={user.role} onNavigate={() => setMenuOpen(false)} />
              </div>
              <div className="p-3">{userChip}</div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-gray-950/60 px-4 py-3 backdrop-blur-xl md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
              className="rounded-lg p-1.5 text-gray-300 hover:bg-white/5 md:hidden"
            >
              <Icon name="menu" />
            </button>
            <p className="min-w-0 truncate text-sm text-gray-300">
              {user.name} · <span className="text-gray-500">{ROLE_TITLES[user.role]}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {user.libraryId && <NotificationBell />}
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-gray-400 transition hover:bg-white/5 hover:text-gray-100"
            >
              <Icon name="logOut" className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-7 md:px-8">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
          {user.role === 'member' && <MembershipCelebration />}
        </main>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function HomeShell({ title, children }: { title: string; children?: ReactNode }) {
  const { data: user } = useMe();
  return (
    <div>
      <p className="text-sm font-medium text-brand-300">{greeting()}</p>
      <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{title}</h1>
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
