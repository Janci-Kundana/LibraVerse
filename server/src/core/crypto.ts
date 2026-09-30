import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env';

// AES-256-GCM for secrets stored in the database (per-library Razorpay key
// secret and webhook secret). A fresh random IV per value; the auth tag makes
// any tampering fail decryption. Decrypt only at the point of use.

export interface EncryptedValue {
  iv: string;
  tag: string;
  data: string;
}

const key = () => Buffer.from(env.ENCRYPTION_KEY, 'base64');

export function encryptSecret(plain: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
