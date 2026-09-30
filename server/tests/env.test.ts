import { parseEnv } from '../src/config/env';

const secrets = {
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CARD_QR_SECRET: 'c'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('parseEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = parseEnv({ MONGODB_URI: 'mongodb://localhost/x', ...secrets });
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 4000, SMTP_PORT: 587 });
  });

  it('rejects a missing or malformed MONGODB_URI', () => {
    expect(() => parseEnv({ ...secrets })).toThrow(/MONGODB_URI/);
    expect(() => parseEnv({ MONGODB_URI: 'http://nope', ...secrets })).toThrow(/MONGODB_URI/);
  });

  it('requires long, distinct JWT secrets', () => {
    const uri = { MONGODB_URI: 'mongodb://localhost/x' };
    expect(() => parseEnv({ ...uri, ...secrets, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() =>
      parseEnv({
        ...uri,
        ...secrets,
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'a'.repeat(32),
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });
});
