import { env } from '../config/env';

/**
 * Render's free plan stops the API after 15 idle minutes, and the next visitor
 * waits ~30-60 s for it to start. Requesting our own public URL counts as
 * incoming traffic, so a ping every 10 minutes keeps it awake.
 */
export function keepAliveUrl(e: Pick<typeof env, 'NODE_ENV' | 'PUBLIC_API_URL'> = env) {
  if (e.NODE_ENV !== 'production' || !e.PUBLIC_API_URL) return null;
  return new URL('/api/health', e.PUBLIC_API_URL).toString();
}

export async function pingSelf(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`keep-alive ping returned ${res.status}`);
}
