// Usage: npm run render-env -w server
// Writes the production settings for Render to ~/Desktop/libraverse-render.env,
// ready for Render → Environment → "Add from .env". Keeps ENCRYPTION_KEY and
// CARD_QR_SECRET the same as here (the shared database holds values encrypted
// with them, and issued card QRs are signed with them). Nothing is printed.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SITE = process.argv[2] ?? 'https://libraverse.vercel.app';
const API = process.argv[3] ?? 'https://libraverse-api.onrender.com';
const e = process.env;
const fresh = () => randomBytes(48).toString('base64url');

const values: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  NODE_VERSION: '22',
  MONGODB_URI: e.MONGODB_URI,
  CLIENT_URL: SITE,
  PUBLIC_API_URL: API,
  JWT_ACCESS_SECRET: fresh(),
  JWT_REFRESH_SECRET: fresh(),
  CARD_QR_SECRET: e.CARD_QR_SECRET,
  ENCRYPTION_KEY: e.ENCRYPTION_KEY,
  SMTP_HOST: e.SMTP_HOST,
  SMTP_PORT: e.SMTP_PORT,
  SMTP_USER: e.SMTP_USER,
  SMTP_PASS: e.SMTP_PASS,
  MAIL_FROM: e.MAIL_FROM,
  CLOUDINARY_URL: e.CLOUDINARY_URL,
  PLATFORM_RAZORPAY_KEY_ID: e.PLATFORM_RAZORPAY_KEY_ID,
  PLATFORM_RAZORPAY_KEY_SECRET: e.PLATFORM_RAZORPAY_KEY_SECRET,
  PLATFORM_RAZORPAY_WEBHOOK_SECRET: e.PLATFORM_RAZORPAY_WEBHOOK_SECRET,
  VAPID_PUBLIC_KEY: e.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: e.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: e.VAPID_SUBJECT,
  ANTHROPIC_API_KEY: e.ANTHROPIC_API_KEY,
  GOOGLE_CLIENT_ID: e.GOOGLE_CLIENT_ID,
};

const lines = Object.entries(values)
  .filter(([, v]) => v && v.trim())
  .map(([k, v]) => `${k}=${/[\s#"'<>]/.test(v!) ? `"${v!.replace(/"/g, '\\"')}"` : v}`);
const missing = Object.entries(values)
  .filter(([, v]) => !v || !v.trim())
  .map(([k]) => k);

const out = join(homedir(), 'Desktop', 'libraverse-render.env');
writeFileSync(out, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote ${lines.length} settings to ${out}`);
console.log(`Site ${SITE}, API ${API}`);
if (missing.length) console.log(`Not set yet (optional): ${missing.join(', ')}`);
console.log('Paste it into Render → Environment → "Add from .env", then delete the file.');
