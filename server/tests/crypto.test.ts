import { decryptSecret, encryptSecret } from '../src/core/crypto';

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips, with a new IV every time', () => {
    const a = encryptSecret('rzp_secret_123');
    const b = encryptSecret('rzp_secret_123');
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(a.data).not.toContain('rzp_secret_123');
    expect(decryptSecret(a)).toBe('rzp_secret_123');
  });

  it('refuses tampered ciphertext or tag', () => {
    const v = encryptSecret('rzp_secret_123');
    const flipped = Buffer.from(v.data, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret({ ...v, data: flipped.toString('base64') })).toThrow();
    expect(() => decryptSecret({ ...v, tag: Buffer.alloc(16).toString('base64') })).toThrow();
  });
});
