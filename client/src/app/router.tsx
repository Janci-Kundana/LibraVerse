import { createBrowserRouter, type RouteObject } from 'react-router';
import { AdminLibrariesPage } from '../features/admin/AdminLibrariesPage';
import { ForgotPasswordPage } from '../features/auth/ForgotPasswordPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireRole } from '../features/auth/RequireRole';
import { SetPasswordPage } from '../features/auth/SetPasswordPage';
import { DashboardLayout } from '../features/dashboard/DashboardLayout';
import { LibraryHome, MemberHome } from '../features/dashboard/homes';
import { SecurityPage } from '../features/dashboard/SecurityPage';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from '../features/landing/NotFoundPage';
import { RegisterLibraryPage } from '../features/libraries/RegisterLibraryPage';

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/set-password', element: <SetPasswordPage /> },
  { path: '/register-library', element: <RegisterLibraryPage /> },
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
    children: [{ index: true, element: <MemberHome /> }],
  },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
