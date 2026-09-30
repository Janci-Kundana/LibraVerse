import { vi } from 'vitest';

interface MockResponse {
  status: number;
  body?: unknown;
}
type Handler = MockResponse | ((body: unknown) => MockResponse);

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

/**
 * Routes fetch calls by "METHOD /path?query" (or "METHOD /path") to canned
 * responses. Unmatched calls get a 404. Returns the list of calls made.
 */
export function mockApi(routes: Record<string, Handler>): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init.method ?? 'GET';
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname + url.search, body });
    const handler =
      routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    const res: MockResponse = !handler
      ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'not mocked' } } }
      : typeof handler === 'function'
        ? handler(body)
        : handler;
    return {
      ok: res.status < 400,
      status: res.status,
      statusText: '',
      json: async () => res.body,
    } as Response;
  });
  return calls;
}

export const unauthenticated: MockResponse = {
  status: 401,
  body: { error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } },
};

export function authUser(role: 'superAdmin' | 'libraryAdmin' | 'librarian' | 'member') {
  return {
    id: 'u1',
    name: `Test ${role}`,
    email: `${role}@x.test`,
    role,
    libraryId: role === 'superAdmin' ? null : 'lib1',
    libraryName: role === 'superAdmin' ? null : 'City Library',
    twoFactorEnabled: false,
  };
}

export function memberProfile(
  verificationStatus: 'pending' | 'approved' | 'rejected' = 'approved',
) {
  return {
    id: 'mp1',
    verificationStatus,
    verificationNote: verificationStatus === 'rejected' ? 'Photo is blurry' : null,
    membershipNo: verificationStatus === 'approved' ? '4123456789012345' : null,
    planId: null,
    planName: null,
    validTill: null,
    cardTier: 'member',
    walletBalance: 0,
    badges: [],
    nextPlan: null,
    hasPhoto: true,
    photoChange: null,
  };
}

/** Routes the member home page loads, for an approved member with no plan yet. */
export const approvedMemberRoutes = {
  'GET /api/member/profile': { status: 200, body: memberProfile('approved') },
  'GET /api/member/plans': { status: 200, body: [] },
};
