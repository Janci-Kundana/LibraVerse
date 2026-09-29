// TC-07: a Library A user cannot read or change Library B's data.
// Add every new tenant collection to TENANT_MODELS; the guard test at the
// bottom fails if a model with a libraryId path is missing from it.
import mongoose, { Types, type Model } from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { TenantContextError, runAsSystem, runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { BookModel } from '../src/modules/books/model';
import { BranchModel } from '../src/modules/branches/model';
import { BookCopyModel } from '../src/modules/copies/model';
import { ReviewModel } from '../src/modules/reviews/model';
import { CouponModel } from '../src/modules/coupons/model';
import { LoanModel } from '../src/modules/loans/model';
import { ReservationModel } from '../src/modules/reservations/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { MembershipPlanModel } from '../src/modules/membershipPlans/model';
import { SubscriptionModel } from '../src/modules/subscriptions/model';
import { UserModel } from '../src/modules/users/model';
import { createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

interface TenantCase {
  model: Model<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Valid fields for one document (libraryId is filled in by the tenant context). */
  data: (tag: string) => Record<string, unknown>;
  /** A harmless field update, or null when the model is append-only. */
  update: Record<string, unknown> | null;
}

const TENANT_MODELS: TenantCase[] = [
  {
    model: BranchModel,
    data: (tag) => ({ name: `Branch ${tag}` }),
    update: { address: 'changed' },
  },
  {
    model: UserModel,
    data: (tag) => ({ name: tag, email: `${tag}@x.test`, role: 'member', status: 'active' }),
    update: { name: 'changed' },
  },
  {
    model: SubscriptionModel,
    data: () => ({ platformPlanId: new Types.ObjectId() }),
    update: { status: 'cancelled' },
  },
  {
    model: MemberProfileModel,
    data: () => ({
      userId: new Types.ObjectId(),
      idProofKey: 'private/id/x.png',
      termsAcceptedAt: new Date(),
    }),
    update: { verificationStatus: 'approved' },
  },
  {
    model: MembershipPlanModel,
    data: (tag) => ({
      name: `Plan ${tag}`,
      price: 10000,
      durationDays: 30,
      bookLimit: 2,
      finePerDay: 500,
    }),
    update: { price: 1 },
  },
  {
    model: CouponModel,
    data: (tag) => ({
      code: `CODE${tag.toUpperCase()}`,
      discountPercent: 10,
      validTill: new Date(),
    }),
    update: { discountPercent: 99 },
  },
  {
    model: BookModel,
    data: (tag) => ({ title: `Book ${tag}` }),
    update: { title: 'changed' },
  },
  {
    model: BookCopyModel,
    data: (tag) => ({
      bookId: new Types.ObjectId(),
      branchId: new Types.ObjectId(),
      qrCode: `LVC-${tag}`,
    }),
    update: { status: 'lost' },
  },
  {
    model: ReviewModel,
    data: () => ({ bookId: new Types.ObjectId(), memberId: new Types.ObjectId(), rating: 4 }),
    update: { rating: 1 },
  },
  {
    model: LoanModel,
    data: () => ({
      copyId: new Types.ObjectId(),
      bookId: new Types.ObjectId(),
      memberId: new Types.ObjectId(),
      issuedBy: new Types.ObjectId(),
      issuedAt: new Date(),
      dueAt: new Date(),
      finePerDay: 500,
    }),
    update: { fineAmount: 99_999 },
  },
  {
    model: ReservationModel,
    data: () => ({ bookId: new Types.ObjectId(), memberId: new Types.ObjectId() }),
    update: { status: 'cancelled' },
  },
  {
    model: AuditLogModel,
    data: (tag) => ({
      seq: tag.length,
      action: 'test.created',
      target: { type: 'test', id: tag },
      prevHash: '0',
      hash: tag,
    }),
    update: null,
  },
];

// Collections that belong to the platform, not to one library.
const PLATFORM_MODELS = ['Library', 'PlatformPlan', 'Session'];

describe.each(TENANT_MODELS.map((c) => [c.model.modelName, c] as const))(
  'tenant isolation: %s',
  (_name, tc) => {
    let a: string;
    let b: string;
    let docA: { _id: Types.ObjectId };
    let docB: { _id: Types.ObjectId };

    beforeEach(async () => {
      a = (await createLibrary('lib-a')).id;
      b = (await createLibrary('lib-b')).id;
      docA = await runWithTenant(a, () => tc.model.create(tc.data('a')));
      docB = await runWithTenant(b, () => tc.model.create(tc.data('b')));
    });

    const inA = <T>(fn: () => T | PromiseLike<T>) => runWithTenant(a, fn);
    const countIn = (libraryId: string) =>
      runAsSystem('test', () => tc.model.countDocuments({ libraryId }));

    it('reads only its own documents', async () => {
      const ids = await inA(() => tc.model.find().distinct('_id'));
      expect(ids.map(String)).toContain(String(docA._id));
      expect(ids.map(String)).not.toContain(String(docB._id));
      expect(await inA(() => tc.model.findById(docB._id))).toBeNull();
      expect(await inA(() => tc.model.findOne({ _id: docB._id }))).toBeNull();
      expect(await inA(() => tc.model.countDocuments({ _id: docB._id }))).toBe(0);
    });

    it('cannot widen a query to another library by naming its libraryId', async () => {
      expect(await inA(() => tc.model.find({ libraryId: b }))).toHaveLength(0);
      expect(
        await inA(() => tc.model.find({ $or: [{ libraryId: b }, { _id: docB._id }] })),
      ).toHaveLength(0);
    });

    it('scopes aggregates', async () => {
      const rows = await inA(() => tc.model.aggregate([{ $group: { _id: '$libraryId' } }]));
      expect(rows.map((r: { _id: unknown }) => String(r._id))).toEqual([a]);
    });

    it('cannot update or delete the other library’s documents', async () => {
      const bBefore = await countIn(b);
      if (tc.update) {
        const upd = await inA(() => tc.model.updateOne({ _id: docB._id }, { $set: tc.update! }));
        expect(upd.matchedCount).toBe(0);
        const many = await inA(() => tc.model.updateMany({}, { $set: tc.update! }));
        expect(many.matchedCount).toBe(await countIn(a)); // only A's
        expect(
          await inA(() => tc.model.findOneAndUpdate({ _id: docB._id }, { $set: tc.update! })),
        ).toBeNull();
        const del = await inA(() => tc.model.deleteOne({ _id: docB._id }));
        expect(del.deletedCount).toBe(0);
        await inA(() => tc.model.deleteMany({}));
      }
      expect(await countIn(b)).toBe(bBefore);
      const stillThere = await runAsSystem('test', () => tc.model.findById(docB._id).lean());
      expect(stillThere).not.toBeNull();
      if (tc.update) expect(stillThere).not.toMatchObject(tc.update);
    });

    it('cannot write a document into another library', async () => {
      const bBefore = await countIn(b);
      await expect(
        inA(() => new tc.model({ ...tc.data('x1'), libraryId: b }).save()),
      ).rejects.toThrow(TenantContextError);
      await expect(
        inA(() => tc.model.insertMany([{ ...tc.data('x2'), libraryId: b }])),
      ).rejects.toThrow(TenantContextError);
      if (tc.update) {
        await expect(
          inA(() => tc.model.updateOne({ _id: docA._id }, { $set: { libraryId: b } })),
        ).rejects.toThrow(TenantContextError);
      }
      expect(await countIn(b)).toBe(bBefore);
    });

    it('refuses to run without a tenant context', async () => {
      await expect(tc.model.find().exec()).rejects.toThrow(TenantContextError);
      await expect(tc.model.aggregate([]).exec()).rejects.toThrow(TenantContextError);
      await expect(tc.model.countDocuments().exec()).rejects.toThrow(TenantContextError);
    });
  },
);

describe('tenant isolation: coverage guard', () => {
  it('lists every model that carries libraryId', () => {
    const covered = new Set(TENANT_MODELS.map((c) => c.model.modelName));
    for (const name of mongoose.modelNames()) {
      if (PLATFORM_MODELS.includes(name)) {
        expect(mongoose.model(name).schema.path('libraryId')).toBeUndefined();
        continue;
      }
      expect({ name, covered: covered.has(name) }).toEqual({ name, covered: true });
    }
  });
});

describe('TC-07 over the API', () => {
  it('a Library A librarian gets Library A branches only, and 404 for a Library B branch', async () => {
    const libA = await createLibrary('lib-a');
    const libB = await createLibrary('lib-b');
    await createUser({ libraryId: libA.id, role: 'librarian', email: 'staff@a.test' });

    const agent = await signedInAgent(app, 'staff@a.test');
    const list = await agent.get('/api/branches');
    expect(list.status).toBe(200);
    expect(list.body.map((x: { id: string }) => x.id)).toEqual([String(libA.branch._id)]);

    const other = await agent.get(`/api/branches/${libB.branch._id}`);
    expect(other.status).toBe(404);
  });

  it('the Super Admin cannot read a library’s branches', async () => {
    await createLibrary('lib-a');
    await createUser({ libraryId: null, role: 'superAdmin', email: 'root@platform.test' });
    const agent = await signedInAgent(app, 'root@platform.test');
    expect((await agent.get('/api/branches')).status).toBe(403);
  });

  it('rejects unauthenticated access', async () => {
    expect((await request(app).get('/api/branches')).status).toBe(401);
  });
});
