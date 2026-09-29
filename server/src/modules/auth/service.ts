import bcrypt from 'bcrypt';
import { Types } from 'mongoose';
import { isStaff, type AuthUser, type LibraryChoice } from '@libraverse/shared';
import { env } from '../../config/env';
import { AppError } from '../../core/errors';
import { sendMail } from '../../core/mailer';
import { runAsSystem } from '../../core/tenant';
import { LibraryModel } from '../libraries/model';
import { UserModel, type OtpPurpose, type UserDoc } from '../users/model';
import { SessionModel } from './sessionModel';
import {
  REFRESH_TTL_SECONDS,
  hashOtp,
  newJti,
  newLinkToken,
  newOtpCode,
  safeEqualHex,
  sha256,
  signAccess,
  signChallenge,
  signRefresh,
  verifyChallenge,
  verifyRefresh,
} from './tokens';

// Auth resolves the tenant from the credential, so its user lookups run in
// system context. Each one is keyed by email, token hash or the token's user id.

const BCRYPT_ROUNDS = env.NODE_ENV === 'test' ? 4 : 12;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SETUP_LINK_TTL_MS = 48 * 60 * 60 * 1000;
// Compared against when no account matches, so response time does not reveal it.
const DUMMY_HASH = bcrypt.hashSync('libraverse-dummy-password', 4);

export interface Tokens {
  access: string;
  refresh: string;
}

export type LoginResult =
  | { status: 'ok'; user: AuthUser; tokens: Tokens }
  | { status: 'twoFactorRequired'; challengeToken: string };

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);

async function libraryNames(ids: (Types.ObjectId | null | undefined)[]) {
  const real = ids.filter((id): id is Types.ObjectId => id != null);
  const libs = await LibraryModel.find({ _id: { $in: real } })
    .select('name')
    .lean();
  return new Map(libs.map((l) => [String(l._id), l.name]));
}

export async function toAuthUser(user: UserDoc): Promise<AuthUser> {
  const names = await libraryNames([user.libraryId]);
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    libraryId: user.libraryId ? String(user.libraryId) : null,
    libraryName: user.libraryId ? (names.get(String(user.libraryId)) ?? null) : null,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

/** Library users may sign in only while their library is active. */
async function assertLibraryActive(user: UserDoc) {
  if (!user.libraryId) return;
  const library = await LibraryModel.findById(user.libraryId).select('status').lean();
  if (library?.status === 'active') return;
  const messages: Record<string, string> = {
    pending: 'Your library is waiting for approval',
    suspended: 'Your library has been suspended',
    rejected: 'Your library registration was rejected',
  };
  throw new AppError(
    403,
    'LIBRARY_NOT_ACTIVE',
    messages[library?.status ?? ''] ?? 'Library not found',
    { libraryStatus: library?.status ?? null },
  );
}

export async function startSession(user: UserDoc): Promise<Tokens> {
  const jti = newJti();
  const session = await SessionModel.create({
    userId: user._id,
    jtiHash: sha256(jti),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
  });
  return issueTokens(user, String(session._id), jti);
}

function issueTokens(user: UserDoc, sid: string, jti: string): Tokens {
  return {
    access: signAccess({
      sub: String(user._id),
      role: user.role,
      lib: user.libraryId ? String(user.libraryId) : null,
    }),
    refresh: signRefresh({ sub: String(user._id), sid, jti }),
  };
}

async function setOtp(users: UserDoc[], purpose: OtpPurpose): Promise<string> {
  const code = newOtpCode();
  const otp = {
    purpose,
    codeHash: hashOtp(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    attempts: 0,
  };
  await UserModel.updateMany({ _id: { $in: users.map((u) => u._id) } }, { $set: { otp } });
  return code;
}

/** Checks `code` against the user's pending OTP, counting failed attempts. */
async function consumeOtp(user: UserDoc, purpose: OtpPurpose, code: string): Promise<boolean> {
  const otp = user.otp;
  if (!otp || otp.purpose !== purpose || otp.expiresAt < new Date()) return false;
  if ((otp.attempts ?? 0) >= OTP_MAX_ATTEMPTS) return false;
  if (!safeEqualHex(otp.codeHash, hashOtp(code))) {
    await UserModel.updateOne({ _id: user._id }, { $inc: { 'otp.attempts': 1 } });
    return false;
  }
  await UserModel.updateOne({ _id: user._id }, { $set: { otp: null } });
  return true;
}

export function login(input: {
  email: string;
  password: string;
  libraryId?: string | null;
}): Promise<LoginResult> {
  return runAsSystem('auth:login', async (): Promise<LoginResult> => {
    const candidates = await UserModel.find({ email: input.email, status: 'active' }).select(
      '+passwordHash',
    );
    if (candidates.length === 0) {
      await bcrypt.compare(input.password, DUMMY_HASH);
      throw invalidCredentials();
    }

    let matches: UserDoc[] = [];
    for (const user of candidates) {
      if (user.passwordHash && (await bcrypt.compare(input.password, user.passwordHash))) {
        matches.push(user);
      }
    }
    if (input.libraryId !== undefined) {
      matches = matches.filter((u) => String(u.libraryId ?? null) === String(input.libraryId));
    }
    if (matches.length === 0) throw invalidCredentials();

    if (matches.length > 1) {
      const names = await libraryNames(matches.map((u) => u.libraryId));
      const choices: LibraryChoice[] = matches.map((u) => ({
        libraryId: u.libraryId ? String(u.libraryId) : null,
        libraryName: u.libraryId
          ? (names.get(String(u.libraryId)) ?? 'Unknown library')
          : 'LibraVerse platform',
        role: u.role,
      }));
      throw new AppError(
        409,
        'LIBRARY_CHOICE_REQUIRED',
        'This email has accounts in several libraries. Choose one.',
        choices,
      );
    }

    const user = matches[0]!;
    await assertLibraryActive(user);

    if (user.twoFactorEnabled && isStaff(user.role)) {
      const code = await setOtp([user], 'login');
      await sendMail({
        to: user.email,
        subject: 'Your LibraVerse sign-in code',
        text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not try to sign in, change your password.`,
      });
      return { status: 'twoFactorRequired', challengeToken: signChallenge(String(user._id)) };
    }

    return { status: 'ok', user: await toAuthUser(user), tokens: await startSession(user) };
  });
}

export function verifyLoginOtp(challengeToken: string, code: string) {
  const { sub } = verifyChallenge(challengeToken);
  return runAsSystem('auth:login-otp', async () => {
    const user = await UserModel.findOne({ _id: sub, status: 'active' }).select('+otp');
    if (!user || !(await consumeOtp(user, 'login', code))) {
      throw new AppError(401, 'INVALID_CODE', 'The code is wrong or has expired');
    }
    await assertLibraryActive(user);
    return { user: await toAuthUser(user), tokens: await startSession(user) };
  });
}

/** Rotates the refresh token. Presenting an already-rotated token revokes the session. */
export function refresh(refreshToken: string) {
  const claims = verifyRefresh(refreshToken);
  return runAsSystem('auth:refresh', async () => {
    const session = await SessionModel.findById(claims.sid);
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Session ended, sign in again');
    }
    if (!safeEqualHex(session.jtiHash, sha256(claims.jti))) {
      session.revokedAt = new Date();
      session.revokedReason = 'refresh token reused';
      await session.save();
      throw new AppError(401, 'REFRESH_REUSED', 'Session ended, sign in again');
    }

    const user = await UserModel.findOne({ _id: claims.sub, status: 'active' });
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Session ended, sign in again');
    await assertLibraryActive(user);

    const jti = newJti();
    session.jtiHash = sha256(jti);
    await session.save();
    return { user: await toAuthUser(user), tokens: issueTokens(user, String(session._id), jti) };
  });
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  try {
    const { sid } = verifyRefresh(refreshToken);
    await SessionModel.updateOne(
      { _id: sid, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    );
  } catch {
    // An invalid or expired token has nothing left to revoke.
  }
}

export function me(userId: string) {
  return runAsSystem('auth:me', async () => {
    const user = await UserModel.findOne({ _id: userId, status: 'active' });
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    return toAuthUser(user);
  });
}

/** Emails one reset code to every active account on this email. Silent when there are none. */
export function forgotPassword(email: string) {
  return runAsSystem('auth:forgot-password', async () => {
    const users = await UserModel.find({ email, status: 'active' });
    if (users.length === 0) return;
    const code = await setOtp(users, 'reset');
    await sendMail({
      to: email,
      subject: 'Reset your LibraVerse password',
      text: `Your password reset code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for this, ignore this email.`,
    });
  });
}

/** Sets the new password on every account on this email whose reset code matches. */
export function resetPassword(input: { email: string; code: string; password: string }) {
  return runAsSystem('auth:reset-password', async () => {
    const users = await UserModel.find({ email: input.email, status: 'active' }).select('+otp');
    const matched: UserDoc[] = [];
    for (const user of users) {
      if (await consumeOtp(user, 'reset', input.code)) matched.push(user);
    }
    if (matched.length === 0) {
      throw new AppError(400, 'INVALID_CODE', 'The code is wrong or has expired');
    }
    const ids = matched.map((u) => u._id);
    await UserModel.updateMany(
      { _id: { $in: ids } },
      { $set: { passwordHash: await hashPassword(input.password) } },
    );
    await SessionModel.updateMany(
      { userId: { $in: ids }, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'password reset' } },
    );
  });
}

/** Creates a set-password link for an invited user; returns the link to email or print. */
export async function issuePasswordSetupLink(userId: Types.ObjectId): Promise<string> {
  const token = newLinkToken();
  await runAsSystem('auth:issue-setup-link', () =>
    UserModel.updateOne(
      { _id: userId },
      {
        $set: {
          passwordSetup: {
            tokenHash: sha256(token),
            expiresAt: new Date(Date.now() + SETUP_LINK_TTL_MS),
          },
        },
      },
    ),
  );
  return `${env.CLIENT_URL}/set-password?token=${token}`;
}

export function setupPassword(input: { token: string; password: string }) {
  return runAsSystem('auth:setup-password', async () => {
    const user = await UserModel.findOne({
      'passwordSetup.tokenHash': sha256(input.token),
      'passwordSetup.expiresAt': { $gt: new Date() },
      status: { $in: ['invited', 'active'] },
    });
    if (!user) {
      throw new AppError(400, 'INVALID_LINK', 'This link is invalid or has expired');
    }
    await UserModel.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash: await hashPassword(input.password), status: 'active' },
        $unset: { passwordSetup: 1 },
      },
    );
    return { email: user.email };
  });
}

export function setTwoFactor(userId: string, enabled: boolean) {
  return runAsSystem('auth:two-factor', async () => {
    const user = await UserModel.findOne({ _id: userId, status: 'active' });
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in required');
    if (!isStaff(user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'Two-factor sign-in is for staff accounts');
    }
    user.twoFactorEnabled = enabled;
    await user.save();
    return toAuthUser(user);
  });
}
