import type { ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AdminLibrariesPage } from '../features/admin/AdminLibrariesPage';
import { CounterPage } from '../features/circulation/CounterPage';
import { MyPaymentsPage } from '../features/payments/MemberPayments';
import {
  PaymentSettingsPage,
  PaymentsPage,
  PublicPayPage,
} from '../features/payments/StaffPayments';
import { LoansPage, ReservationsPage } from '../features/circulation/LoansPage';
import { CardPage } from '../features/card/CardPage';
import { MyLoansPage } from '../features/circulation/MemberCirculationPages';
import {
  MemberBookPage,
  MemberCatalogPage,
  WishlistPage,
} from '../features/catalog/MemberCatalogPages';
import {
  ImportBooksPage,
  NewBookPage,
  StaffBookPage,
  StaffCatalogPage,
} from '../features/catalog/StaffCatalogPages';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireRole } from '../features/auth/RequireRole';
import { SetPasswordPage } from '../features/auth/SetPasswordPage';
import { DashboardLayout } from '../features/dashboard/DashboardLayout';
import { LibraryHome } from '../features/dashboard/homes';
import { SecurityPage } from '../features/dashboard/SecurityPage';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from '../features/landing/NotFoundPage';
import { RegisterLibraryPage } from '../features/libraries/RegisterLibraryPage';
import { BranchesPage } from '../features/library/BranchesPage';
import { PlansPage } from '../features/library/PlansPage';
import { SettingsPage } from '../features/library/SettingsPage';
import { StaffPage } from '../features/library/StaffPage';
import { VerificationsPage } from '../features/library/VerificationsPage';
import { JoinPage } from '../features/members/JoinPage';
import { MemberHome } from '../features/members/MemberHome';
import { VerifiedOnly } from '../features/members/VerifiedOnly';

/** Member pages beyond Home need an approved ID. */
const verified = (element: ReactNode) => <VerifiedOnly>{element}</VerifiedOnly>;

/** Library-admin-only pages inside the /library area. */
const adminOnly = (element: ReactNode) => (
  <RequireRole roles={['libraryAdmin']}>{element}</RequireRole>
);

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  { path: '/register-library', element: <RegisterLibraryPage /> },
  { path: '/join', element: <JoinPage /> },
  { path: '/pay/:token', element: <PublicPayPage /> },
  {
    path: '/admin',
    element: (
      <RequireRole roles={['superAdmin']}>
        <DashboardLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <AdminLibrariesPage /> },
      { path: 'security', element: <SecurityPage /> },
    ],
  },
  {
    path: '/library',
    element: (
      <RequireRole roles={['librarian']}>
        <DashboardLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <LibraryHome /> },
      { path: 'counter', element: <CounterPage /> },
      { path: 'loans', element: <LoansPage /> },
      { path: 'payments', element: <PaymentsPage /> },
      { path: 'payment-settings', element: adminOnly(<PaymentSettingsPage />) },
      { path: 'reservations', element: <ReservationsPage /> },
      { path: 'verifications', element: <VerificationsPage /> },
      { path: 'catalog', element: <StaffCatalogPage /> },
      { path: 'catalog/new', element: <NewBookPage /> },
      { path: 'catalog/import', element: <ImportBooksPage /> },
      { path: 'catalog/:id', element: <StaffBookPage /> },
      { path: 'plans', element: adminOnly(<PlansPage />) },
      { path: 'branches', element: adminOnly(<BranchesPage />) },
      { path: 'staff', element: adminOnly(<StaffPage />) },
      { path: 'settings', element: adminOnly(<SettingsPage />) },
      { path: 'security', element: <SecurityPage /> },
    ],
  },
  {
    path: '/member',
    element: (
      <RequireRole roles={['member']}>
        <DashboardLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: <MemberHome /> },
      { path: 'card', element: verified(<CardPage />) },
      { path: 'loans', element: verified(<MyLoansPage />) },
      { path: 'payments', element: verified(<MyPaymentsPage />) },
      { path: 'catalog', element: verified(<MemberCatalogPage />) },
      { path: 'books/:id', element: verified(<MemberBookPage />) },
      { path: 'wishlist', element: verified(<WishlistPage />) },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
