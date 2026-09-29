import request from 'supertest';
import type { Express } from 'express';
import type { LibraryStatus, PlatformPlanCode, Role } from '@libraverse/shared';
import { testOutbox } from '../../src/core/mailer';
import { runAsSystem } from '../../src/core/tenant';
import { hashPassword } from '../../src/modules/auth/service';
import { BranchModel } from '../../src/modules/branches/model';
import { LibraryModel } from '../../src/modules/libraries/model';
import { PlatformPlanModel } from '../../src/modules/platformPlans/model';
import { ensureDefaultPlans } from '../../src/modules/platformPlans/service';
import { SubscriptionModel } from '../../src/modules/subscriptions/model';
import { UserModel } from '../../src/modules/users/model';

export const PASSWORD = 'Readers4ever';

export function createLibrary(
  slug: string,
  status: LibraryStatus = 'active',
  opts: { plan?: PlatformPlanCode } = {},
) {
  return runAsSystem('test', async () => {
    const library = await LibraryModel.create({
      name: `Library ${slug}`,
      slug,
      ownerName: `Owner ${slug}`,
      contactEmail: `owner@${slug}.test`,
      status,
    });
    const branch = await BranchModel.create({ libraryId: library._id, name: `${slug} main` });
    if (opts.plan) {
      await ensureDefaultPlans();
      const plan = await PlatformPlanModel.findOne({ code: opts.plan }).lean();
      await SubscriptionModel.create({
        libraryId: library._id,
        platformPlanId: plan!._id,
        status: 'active',
      });
    }
    return { library, branch, id: String(library._id) };
  });
}

export function createUser(opts: {
  libraryId: string | null;
  role: Role;
  email: string;
  password?: string;
  twoFactorEnabled?: boolean;
  status?: 'invited' | 'active' | 'disabled';
}) {
  return runAsSystem('test', async () =>
    UserModel.create({
      libraryId: opts.libraryId,
      name: `${opts.role} ${opts.email}`,
      email: opts.email,
      role: opts.role,
      status: opts.status ?? 'active',
      twoFactorEnabled: opts.twoFactorEnabled ?? false,
      passwordHash: await hashPassword(opts.password ?? PASSWORD),
    }),
  );
}

/** A supertest agent that keeps cookies, signed in as the given account. */
export async function signedInAgent(
  app: Express,
  email: string,
  opts: { password?: string; libraryId?: string | null } = {},
) {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .send({ email, password: opts.password ?? PASSWORD, libraryId: opts.libraryId });
  if (res.status !== 200 || res.body.status !== 'ok') {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/** The 6-digit code from the most recent email to `to`. */
export function lastCodeSentTo(to: string): string {
  const mail = [...testOutbox].reverse().find((m) => m.to === to);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error(`no code emailed to ${to}`);
  return code;
}

export function lastLinkTokenSentTo(to: string): string {
  const mail = [...testOutbox].reverse().find((m) => m.to === to);
  const token = mail?.text.match(/set-password\?token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`no set-password link emailed to ${to}`);
  return token;
}

export function cookieNames(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : [];
  return list.map((c) => c.split('=')[0]!);
}

/** A tiny file with real PNG / PDF magic bytes, as a data URL. */
export const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]).toString('base64')}`;
export const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 test').toString('base64')}`;
/** Claims to be a PNG but is plain text. */
export const FAKE_PNG_DATA_URL = `data:image/png;base64,${Buffer.from('hello').toString('base64')}`;
