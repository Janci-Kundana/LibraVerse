import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-gray-950 px-4 text-gray-100">
      <div className="text-center">
        <p className="text-sm text-gray-500">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <Link to="/" className="mt-6 inline-block text-brand-500 hover:underline">
          Back to home
        </Link>
      </div>
    </main>
  );
}
