import type { ReactNode } from 'react';

export function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gray-950 px-4 text-gray-300">
      <p role="status">{children}</p>
    </main>
  );
}
