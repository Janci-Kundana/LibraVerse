import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: {
            client_id: string;
            callback: (r: { credential: string }) => void;
          }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** Google Identity Services button; shown only when the server has a client id. */
export function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const cfg = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: () => api<{ googleClientId: string | null }>('/api/auth/config'),
    staleTime: Infinity,
  });
  const el = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  useEffect(() => {
    cb.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const clientId = cfg.data?.googleClientId;
    if (!clientId || !el.current) return;
    const render = () => {
      if (!window.google || !el.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => cb.current(r.credential),
      });
      window.google.accounts.id.renderButton(el.current, {
        theme: 'filled_black',
        size: 'large',
        width: 320,
        text: 'signin_with',
      });
    };
    if (window.google) return render();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.body.appendChild(s);
  }, [cfg.data]);

  if (!cfg.data?.googleClientId) return null;
  return (
    <div className="mt-4 border-t border-gray-800 pt-4">
      <p className="mb-2 text-center text-xs text-gray-500">or</p>
      <div ref={el} className="flex justify-center" />
    </div>
  );
}
