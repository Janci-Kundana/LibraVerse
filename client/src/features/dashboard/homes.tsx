import { HomeShell } from './DashboardLayout';

// Placeholder dashboards: catalog, circulation and payments fill these in later phases.

export function LibraryHome() {
  return (
    <HomeShell title="Library dashboard">
      <p className="mt-6 text-sm text-gray-500">
        Catalog, members and circulation arrive in the next phases.
      </p>
    </HomeShell>
  );
}
