// Usage: npm run seed:demo -w server
// Fills an empty development database with a demo library so every screen has
// something to show. Refuses to run in production. Safe to re-run: it stops if
// the demo library already exists and prints the sign-ins again.
import 'dotenv/config';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { connectDb, disconnectDb } from '../core/db';
import { putFile } from '../core/storage';
import { runAsSystem, runWithTenant } from '../core/tenant';
import { recordAudit } from '../modules/audit/service';
import { hashPassword } from '../modules/auth/service';
import { BookModel } from '../modules/books/model';
import { newCopyCode } from '../modules/books/service';
import { BranchModel } from '../modules/branches/model';
import { BookCopyModel } from '../modules/copies/model';
import { CouponModel } from '../modules/coupons/model';
import { DonationModel } from '../modules/donations/model';
import { EventModel } from '../modules/events/model';
import { LibraryModel } from '../modules/libraries/model';
import { LoanModel } from '../modules/loans/model';
import { MemberProfileModel } from '../modules/members/model';
import { MembershipPlanModel } from '../modules/membershipPlans/model';
import { PlatformPlanModel } from '../modules/platformPlans/model';
import { ensureDefaultPlans } from '../modules/platformPlans/service';
import { SubscriptionModel } from '../modules/subscriptions/model';
import { UserModel } from '../modules/users/model';

const PASSWORD = 'Demo-pass1';
const SLUG = 'riverside';
const DAY = 86_400_000;

const BOOKS: [string, string, string, string, number][] = [
  ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography', 'English', 3],
  ['The Guide', 'R. K. Narayan', 'Fiction', 'English', 2],
  ['Malgudi Days', 'R. K. Narayan', 'Fiction', 'English', 2],
  ['Godaan', 'Premchand', 'Fiction', 'Hindi', 2],
  ['The Discovery of India', 'Jawaharlal Nehru', 'History', 'English', 1],
  ['India After Gandhi', 'Ramachandra Guha', 'History', 'English', 2],
  ['Sapiens', 'Yuval Noah Harari', 'History', 'English', 2],
  ['A Brief History of Time', 'Stephen Hawking', 'Science', 'English', 1],
  ['The Selfish Gene', 'Richard Dawkins', 'Science', 'English', 1],
  ['Dune', 'Frank Herbert', 'Science fiction', 'English', 2],
  ['Foundation', 'Isaac Asimov', 'Science fiction', 'English', 1],
  ['Clean Code', 'Robert C. Martin', 'Computing', 'English', 2],
];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('seed:demo never runs in production');
  await connectDb(env.MONGODB_URI);
  try {
    await runAsSystem('script:seed-demo', async () => {
      await ensureDefaultPlans();
      if (await LibraryModel.exists({ slug: SLUG })) {
        console.log('The demo library already exists.');
        return;
      }
      const hash = await hashPassword(PASSWORD);
      if (!(await UserModel.exists({ email: 'admin@libraverse.demo', libraryId: null }))) {
        await UserModel.create({
          name: 'Platform Admin',
          email: 'admin@libraverse.demo',
          role: 'superAdmin',
          libraryId: null,
          status: 'active',
          passwordHash: hash,
        });
      }

      const library = await LibraryModel.create({
        name: 'Riverside Reading Room',
        slug: SLUG,
        ownerName: 'Asha Rao',
        contactEmail: 'owner@riverside.demo',
        status: 'active',
        cardColours: ['#c0263a', '#111827'],
      });
      const free = await PlatformPlanModel.findOne({ code: 'free' }).orFail();

      await runWithTenant(library._id, async () => {
        const branch = await BranchModel.create({
          name: 'Main branch',
          address: 'MG Road, Bengaluru',
        });
        await SubscriptionModel.create({ platformPlanId: free._id, status: 'active' });
        const owner = await UserModel.create({
          name: 'Asha Rao',
          email: 'owner@riverside.demo',
          role: 'libraryAdmin',
          status: 'active',
          passwordHash: hash,
        });
        await UserModel.create({
          name: 'Ravi Kumar',
          email: 'librarian@riverside.demo',
          role: 'librarian',
          status: 'active',
          passwordHash: hash,
          branchId: branch._id,
        });
        const member = await UserModel.create({
          name: 'Meera Nair',
          email: 'member@riverside.demo',
          role: 'member',
          status: 'active',
          passwordHash: hash,
        });
        const pending = await UserModel.create({
          name: 'Arjun Mehta',
          email: 'newmember@riverside.demo',
          role: 'member',
          status: 'active',
          passwordHash: hash,
        });

        const [silver, gold] = await MembershipPlanModel.create([
          {
            name: 'Silver',
            price: 19900,
            durationDays: 30,
            bookLimit: 2,
            finePerDay: 500,
            tier: 'member',
          },
          {
            name: 'Gold',
            price: 49900,
            durationDays: 90,
            bookLimit: 4,
            finePerDay: 500,
            tier: 'gold',
          },
        ]);
        await MembershipPlanModel.create({
          name: 'Elite',
          price: 149900,
          durationDays: 365,
          bookLimit: 8,
          finePerDay: 300,
          tier: 'elite',
        });
        await CouponModel.create({
          code: 'WELCOME10',
          discountPercent: 10,
          validTill: new Date(Date.now() + 365 * DAY),
        });

        const idProof = await putFile(
          { data: PNG, mime: 'image/png' },
          `id-proofs/${library._id}`,
          'private',
        );
        await MemberProfileModel.create({
          userId: member._id,
          idProofKey: idProof.key,
          termsAcceptedAt: new Date(),
          verificationStatus: 'approved',
          verifiedBy: owner._id,
          verifiedAt: new Date(),
          membershipNo: '4217863091526374',
          planId: gold!._id,
          validTill: new Date(Date.now() + 80 * DAY),
          cardTier: 'gold',
        });
        await MemberProfileModel.create({
          userId: pending._id,
          idProofKey: idProof.key,
          termsAcceptedAt: new Date(),
        });

        const copies: { _id: Types.ObjectId; bookId: Types.ObjectId }[] = [];
        for (const [i, [title, author, category, language, count]] of BOOKS.entries()) {
          const book = await BookModel.create({
            title,
            authors: [author],
            category,
            language,
            createdAt: new Date(Date.now() - (BOOKS.length - i) * DAY),
          });
          for (let c = 0; c < count; c++) {
            copies.push(
              await BookCopyModel.create({
                bookId: book._id,
                branchId: branch._id,
                shelf: `${category[0]}-${c + 1}`,
                qrCode: newCopyCode(),
              }),
            );
          }
        }

        // One overdue loan so reminders, fines and the counter's blocking show up.
        const overdueCopy = copies[0]!;
        await BookCopyModel.updateOne({ _id: overdueCopy._id }, { status: 'issued' });
        const loan = await LoanModel.create({
          copyId: overdueCopy._id,
          bookId: overdueCopy.bookId,
          memberId: member._id,
          issuedBy: owner._id,
          issuedAt: new Date(Date.now() - 17 * DAY),
          // Due 3 days ago (an hour short, so it reads "3 days overdue" all day).
          dueAt: new Date(Date.now() - 3 * DAY + 60 * 60 * 1000),
          finePerDay: silver!.finePerDay,
        });
        await BookModel.updateOne({ _id: overdueCopy.bookId }, { $inc: { borrowCount: 1 } });
        await recordAudit({
          libraryId: library._id,
          actor: { id: owner._id, role: 'libraryAdmin' },
          action: 'loan.issued',
          target: { type: 'loan', id: loan._id },
          details: { seeded: true },
        });

        await DonationModel.create({
          donorName: 'Kavya Iyer',
          donorEmail: 'kavya@example.com',
          title: 'The White Tiger',
          author: 'Aravind Adiga',
          condition: 'good',
        });
        await EventModel.create({
          kind: 'event',
          title: 'Children’s storytelling hour',
          date: new Date(Date.now() + 5 * DAY),
          description: 'Saturday 11 am in the reading room.',
          createdBy: owner._id,
        });
        await EventModel.create({
          kind: 'announcement',
          title: 'Closed on Monday for maintenance',
          description: 'The library reopens on Tuesday at 9 am.',
          createdBy: owner._id,
        });
      });
      console.log('Seeded the demo library "Riverside Reading Room".');
    });

    console.log(`
Sign in at ${env.CLIENT_URL}/login with password ${PASSWORD}:
  Super Admin     admin@libraverse.demo
  Library admin   owner@riverside.demo
  Librarian       librarian@riverside.demo
  Member          member@riverside.demo      (Gold card, one overdue book)
  New member      newmember@riverside.demo   (ID awaiting verification)
`);
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
