// Usage: npm run setup-keys -w server   (run it in your own terminal)
// Asks for each outside service's keys, hides what you type, and writes them
// into server/.env. Press Enter to skip a service or keep what is there.
// Nothing you type is printed or logged.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

// npm run -w server runs in server/, where dotenv reads .env too.
const ENV_PATH = resolve(process.cwd(), '.env');

function readEnv() {
  return existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
}

function current(text: string, key: string) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1]?.replace(/^"(.*)"$/, '$1').trim() ?? '';
}

/** Sets KEY=value in the .env text, replacing the line or appending one. */
function setValue(text: string, key: string, value: string) {
  const v = /[\s#"'<>]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
  const line = `${key}=${v}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
}

/** Reads a line without echoing it (for secrets). */
function askHidden(question: string): Promise<string> {
  return new Promise((done) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    let value = '';
    const onData = (buf: Buffer) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return done(value.trim());
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('Run this in your own terminal: npm run setup-keys -w server');
    process.exit(1);
  }
  let env = readEnv();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q: string) => (await rl.question(q)).trim();
  const has = (k: string) => (current(env, k) ? ' (already set, Enter keeps it)' : '');
  const secret = async (q: string) => {
    rl.pause();
    const v = await askHidden(q);
    rl.resume();
    return v;
  };

  console.log('\nLibraVerse keys. Press Enter to skip anything you do not have yet.\n');

  console.log('1. AI guide: https://console.anthropic.com → API keys → Create key');
  const anthropic = await secret(`   Anthropic API key (sk-ant-…)${has('ANTHROPIC_API_KEY')}: `);
  if (anthropic) env = setValue(env, 'ANTHROPIC_API_KEY', anthropic);

  console.log(
    '\n2. Email: Gmail → Google Account → Security → 2-Step Verification → App passwords',
  );
  const gmail = await ask(`   Gmail address${has('SMTP_USER')}: `);
  if (gmail) {
    const pass = (await secret('   16-letter app password: ')).replace(/\s+/g, '');
    if (pass) {
      env = setValue(env, 'SMTP_HOST', 'smtp.gmail.com');
      env = setValue(env, 'SMTP_PORT', '587');
      env = setValue(env, 'SMTP_USER', gmail);
      env = setValue(env, 'SMTP_PASS', pass);
      env = setValue(env, 'MAIL_FROM', `LibraVerse <${gmail}>`);
    }
  }

  console.log(
    '\n3. Photos: https://console.cloudinary.com → Dashboard → "API environment variable"',
  );
  const cloud = (
    await secret(`   CLOUDINARY_URL (cloudinary://…)${has('CLOUDINARY_URL')}: `)
  ).replace(/^CLOUDINARY_URL=/, '');
  if (cloud) {
    if (/[<>*]|your_api/i.test(cloud))
      console.log(
        '   That is the example line with placeholders. Use Settings → API Keys for the real key and secret; skipped.',
      );
    else if (/^cloudinary:\/\/\d+:[^@]+@.+$/.test(cloud))
      env = setValue(env, 'CLOUDINARY_URL', cloud);
    else console.log('   That does not look like cloudinary://<key>:<secret>@<cloud>; skipped.');
  }

  console.log(
    '\n4. Google sign-in: Google Cloud Console → APIs & Services → Credentials → OAuth client (Web)',
  );
  const google = await ask(
    `   Client ID (…apps.googleusercontent.com)${has('GOOGLE_CLIENT_ID')}: `,
  );
  if (google) env = setValue(env, 'GOOGLE_CLIENT_ID', google);

  console.log(
    '\n5. Platform Razorpay (Pro subscriptions): Razorpay dashboard, Test mode → API keys',
  );
  const keyId = await ask(`   Key id (rzp_test_…)${has('PLATFORM_RAZORPAY_KEY_ID')}: `);
  if (keyId) {
    if (!keyId.startsWith('rzp_test_')) {
      console.log('   Only test-mode keys (rzp_test_…) are allowed; skipped.');
    } else {
      const keySecret = await secret('   Key secret: ');
      if (keySecret) {
        env = setValue(env, 'PLATFORM_RAZORPAY_KEY_ID', keyId);
        env = setValue(env, 'PLATFORM_RAZORPAY_KEY_SECRET', keySecret);
        if (!current(env, 'PLATFORM_RAZORPAY_WEBHOOK_SECRET')) {
          const hook = randomBytes(18).toString('base64url');
          env = setValue(env, 'PLATFORM_RAZORPAY_WEBHOOK_SECRET', hook);
          console.log(
            `   Webhook secret created. Paste it in Razorpay → Webhooks when you add the webhook:\n   ${hook}`,
          );
        }
      }
    }
  }
  rl.close();

  writeFileSync(ENV_PATH, env);
  console.log('\nSaved to server/.env. Checking the services…\n');
}

main()
  // Fresh process, so the checker reads the .env just written.
  .then(() => {
    const r = spawnSync('npx', ['tsx', 'src/scripts/checkServices.ts'], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Something went wrong');
    process.exit(1);
  });
