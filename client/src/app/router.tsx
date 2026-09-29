import type { ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AdminLibrariesPage } from '../features/admin/AdminLibrariesPage';
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
      {
        path: 'catalog',
        element: (
          <VerifiedOnly>
            <MemberCatalogPage />
          </VerifiedOnly>
        ),
      },
      {
        path: 'books/:id',
        element: (
          <VerifiedOnly>
            <MemberBookPage />
          </VerifiedOnly>
        ),
      },
      {
        path: 'wishlist',
        element: (
          <VerifiedOnly>
            <WishlistPage />
          </VerifiedOnly>
        ),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
