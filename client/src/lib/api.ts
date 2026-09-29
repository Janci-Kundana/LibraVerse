import type { ApiError } from '@libraverse/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// Endpoints that must not trigger a silent refresh (they are the auth flow itself).
const NO_REFRESH = /^\/api\/auth\/(login|refresh|logout|password)/;

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, so parallel 401s don't race and trip reuse detection. */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await send(path, init);
  // The access cookie lasts 15 minutes; renew it from the refresh cookie and retry once.
  if (res.status === 401 && !NO_REFRESH.test(path) && (await refreshSession())) {
    res = await send(path, init);
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });

/** Human-readable message for any error thrown by `api`. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
      const first = err.details[0] as { path?: string[]; message?: string } | undefined;
      if (first?.message) return `${first.path?.join('.') ?? 'Input'}: ${first.message}`;
    }
    return err.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}
