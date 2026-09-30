import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  // Public URL of this API (for webhook URLs shown to admins). Defaults to CLIENT_URL,
  // which proxies /api in development.
  PUBLIC_API_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  // Signs member card QR codes (HMAC of member id + library id).
  CARD_QR_SECRET: secret,
  // AES-256-GCM key for per-library Razorpay secrets: 32 random bytes, base64.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),
  // Background jobs (reminders, expiries). Off in tests; set false to disable elsewhere.
  CRON_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Email. Without SMTP_HOST, mail is printed to the console (development only).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('LibraVerse <no-reply@libraverse.local>'),
  // File storage. Without CLOUDINARY_URL, uploads go to UPLOAD_DIR on local disk.
  CLOUDINARY_URL: z
    .string()
    .regex(/^cloudinary:\/\/[^:]+:[^@]+@.+$/, 'must look like cloudinary://<key>:<secret>@<cloud>')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  UPLOAD_DIR: z.string().default('uploads'),
  // Web Push (optional). Generate with: npx web-push generate-vapid-keys
  VAPID_PUBLIC_KEY: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  VAPID_PRIVATE_KEY: z
    .string()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  VAPID_SUBJECT: z.string().default('mailto:admin@libraverse.local'),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  if (result.data.JWT_ACCESS_SECRET === result.data.JWT_REFRESH_SECRET) {
    throw new Error(
      'Invalid environment variables:\n  JWT_REFRESH_SECRET: must differ from JWT_ACCESS_SECRET',
    );
  }
  return result.data;
}

export const env = parseEnv(process.env);
