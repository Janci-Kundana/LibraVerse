// Usage: npm run check-services -w server
// Tests each outside service configured in server/.env with a harmless call
// and prints ✓ / ✗ / "not set". Never prints a key, password or URL.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import Razorpay from 'razorpay';

type Result = { name: string; status: 'ok' | 'fail' | 'off'; detail: string };

const e = process.env;
const set = (v?: string) => Boolean(v && v.trim());

/** Error text with anything that looks like a secret removed. */
function clean(err: unknown) {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err
        ? JSON.stringify((err as { error?: unknown }).error ?? err)
        : String(err);
  const secrets = [
    e.MONGODB_URI,
    e.SMTP_PASS,
    e.CLOUDINARY_URL,
    e.ANTHROPIC_API_KEY,
    e.PLATFORM_RAZORPAY_KEY_SECRET,
  ].filter((s): s is string => set(s));
  let text = raw;
  for (const s of secrets) text = text.split(s).join('***');
  return text.replace(/(mongodb(\+srv)?|cloudinary):\/\/\S+/g, '$1://***').slice(0, 160);
}

async function check(name: string, configured: boolean, run: () => Promise<string>) {
  if (!configured) return { name, status: 'off', detail: 'not set' } as Result;
  try {
    return { name, status: 'ok', detail: await run() } as Result;
  } catch (err) {
    return { name, status: 'fail', detail: clean(err) } as Result;
  }
}

async function main() {
  const results = await Promise.all([
    check('MongoDB Atlas', set(e.MONGODB_URI), async () => {
      await mongoose.connect(e.MONGODB_URI!, { serverSelectionTimeoutMS: 8000 });
      await mongoose.connection.db!.admin().ping();
      await mongoose.disconnect();
      return 'connected';
    }),
    check('Email (SMTP)', set(e.SMTP_HOST), async () => {
      const port = Number(e.SMTP_PORT || 587);
      await nodemailer
        .createTransport({
          host: e.SMTP_HOST,
          port,
          secure: port === 465,
          auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
        })
        .verify();
      return `signed in to ${e.SMTP_HOST}`;
    }),
    check('Cloudinary (photos)', set(e.CLOUDINARY_URL), async () => {
      cloudinary.config({ secure: true });
      await cloudinary.api.ping();
      return 'reachable, credentials accepted';
    }),
    check('Anthropic (AI guide)', set(e.ANTHROPIC_API_KEY), async () => {
      await new Anthropic({ apiKey: e.ANTHROPIC_API_KEY }).models.retrieve('claude-opus-5-5');
      return 'key accepted, claude-opus-5-5 available';
    }),
    check('Platform Razorpay', set(e.PLATFORM_RAZORPAY_KEY_ID), async () => {
      if (!e.PLATFORM_RAZORPAY_KEY_ID!.startsWith('rzp_test_'))
        throw new Error('key id must be a test-mode key (rzp_test_…)');
      if (!set(e.PLATFORM_RAZORPAY_KEY_SECRET)) throw new Error('key secret is missing');
      await new Razorpay({
        key_id: e.PLATFORM_RAZORPAY_KEY_ID!,
        key_secret: e.PLATFORM_RAZORPAY_KEY_SECRET!,
      }).orders.all({ count: 1 });
      return set(e.PLATFORM_RAZORPAY_WEBHOOK_SECRET)
        ? 'keys accepted (test mode), webhook secret set'
        : 'keys accepted (test mode); webhook secret still missing';
    }),
    check('Google sign-in', set(e.GOOGLE_CLIENT_ID), async () => {
      if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(e.GOOGLE_CLIENT_ID!.trim()))
        throw new Error('does not look like <number>-<id>.apps.googleusercontent.com');
      return 'client id format looks right (Google checks it at sign-in)';
    }),
  ]);

  const mark = { ok: '✓', fail: '✗', off: '·' };
  for (const r of results) console.log(`${mark[r.status]} ${r.name.padEnd(22)} ${r.detail}`);
  process.exitCode = results.some((r) => r.status === 'fail') ? 1 : 0;
}

main().catch((err) => {
  console.error(clean(err));
  process.exit(1);
});
