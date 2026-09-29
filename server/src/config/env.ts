import { z } from 'zod';

const secret = z.string().min(32, 'must be at least 32 characters');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'must be a mongodb:// or mongodb+srv:// URI'),
  CLIENT_URL: z.url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: secret,
  JWT_REFRESH_SECRET: secret,
  // Email. Without SMTP_HOST, mail is printed to the console (development only).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('LibraVerse <no-reply@libraverse.local>'),
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
