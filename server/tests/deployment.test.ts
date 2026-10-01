import type { Request } from 'express';
import { authLimitKey } from '../src/core/rateLimit';
import { keepAliveUrl } from '../src/jobs/keepAlive';

const attempt = (ip: string, body: unknown) => ({ ip, body }) as Request;

describe('sign-in rate limit key', () => {
  // Behind Vercel, every visitor can arrive from the same proxy address.
  it('gives different accounts behind one proxy address their own budget', () => {
    expect(authLimitKey(attempt('76.76.21.1', { email: 'a@x.test' }))).not.toBe(
      authLimitKey(attempt('76.76.21.1', { email: 'b@x.test' })),
    );
  });

  it('counts repeated tries at one account together, whatever the email casing', () => {
    expect(authLimitKey(attempt('76.76.21.1', { email: 'A@x.test ' }))).toBe(
      authLimitKey(attempt('76.76.21.1', { email: 'a@x.test' })),
    );
  });

  it('keys OTP attempts on the challenge, without keeping the token itself', () => {
    const key = authLimitKey(attempt('1.2.3.4', { challengeToken: 'secret-challenge' }));
    expect(key).not.toBe(authLimitKey(attempt('1.2.3.4', { challengeToken: 'other' })));
    expect(key).not.toContain('secret-challenge');
  });
});

describe('keep-alive ping', () => {
  it('pings the public health URL in production only', () => {
    expect(
      keepAliveUrl({ NODE_ENV: 'production', PUBLIC_API_URL: 'https://api.example.com' }),
    ).toBe('https://api.example.com/api/health');
    expect(
      keepAliveUrl({ NODE_ENV: 'development', PUBLIC_API_URL: 'https://api.example.com' }),
    ).toBeNull();
    expect(keepAliveUrl({ NODE_ENV: 'production', PUBLIC_API_URL: undefined })).toBeNull();
  });
});
