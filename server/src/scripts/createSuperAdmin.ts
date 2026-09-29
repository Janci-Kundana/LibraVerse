// Usage: npm run create-super-admin -w server -- <email> "<name>"
// Creates the platform owner account (or re-issues its link) and prints a
// set-password link. No password ever goes through the command line.
import 'dotenv/config';
import { z } from 'zod';
import { env } from '../config/env';
import { connectDb, disconnectDb } from '../core/db';
import { runAsSystem } from '../core/tenant';
import { issuePasswordSetupLink } from '../modules/auth/service';
import { UserModel } from '../modules/users/model';

async function main() {
  const [rawEmail, rawName] = process.argv.slice(2);
  const email = z.email().trim().toLowerCase().safeParse(rawEmail);
  if (!email.success) {
    console.error('Usage: npm run create-super-admin -w server -- <email> "<name>"');
    process.exit(1);
  }

  await connectDb(env.MONGODB_URI);
  try {
    await runAsSystem('script:create-super-admin', async () => {
      let user = await UserModel.findOne({ email: email.data, libraryId: null });
      if (user && user.role !== 'superAdmin')
        throw new Error('That email belongs to another account');
      user ??= await UserModel.create({
        name: rawName?.trim() || 'Platform owner',
        email: email.data,
        role: 'superAdmin',
        libraryId: null,
        status: 'invited',
        twoFactorEnabled: false,
      });
      const link = await issuePasswordSetupLink(user._id);
      console.log(`Super Admin: ${user.email}`);
      console.log(`Open this link within 48 hours to set the password:\n${link}`);
    });
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
