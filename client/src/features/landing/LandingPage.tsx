import { Link } from 'react-router';
import { useHealth } from './useHealth';

export function LandingPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Libra<span className="text-brand-500">Verse</span>
        </h1>
        <p className="max-w-xl text-lg text-gray-400">
          Run your whole library digitally. Everything except the books.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/login"
            className="rounded-lg bg-brand-500 px-5 py-2.5 font-medium text-white hover:bg-brand-600"
          >
            Sign in
          </Link>
          <Link
            to="/register-library"
            className="rounded-lg border border-gray-700 px-5 py-2.5 font-medium text-gray-200 hover:bg-gray-800"
          >
            Register your library
          </Link>
        </div>
        <ApiStatus />
      </section>
    </main>
  );
}

function ApiStatus() {
  const { data, isPending, isError } = useHealth();

  let label = 'Checking API…';
  let dot = 'bg-yellow-400';
  if (isError) {
    label = 'API unreachable';
    dot = 'bg-red-500';
  } else if (data) {
    label = `API ok · database ${data.db}`;
    dot = data.db === 'connected' ? 'bg-emerald-400' : 'bg-yellow-400';
  }

  return (
    <p
      role="status"
      aria-busy={isPending}
      className="inline-flex items-center gap-2 rounded-full border border-gray-800 px-4 py-1.5 text-sm text-gray-300"
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </p>
  );
}
