import mongoose, { Types } from 'mongoose';
import { runWithTenant } from '../src/core/tenant';
import { AuditLogModel } from '../src/modules/audit/model';
import { recordAudit, verifyAuditChain } from '../src/modules/audit/service';
import { useTestDb } from './helpers/db';

useTestDb();

const libraryId = new Types.ObjectId();
const actor = { id: new Types.ObjectId(), role: 'librarian' as const };

function record(action: string, details: Record<string, unknown> = {}) {
  return recordAudit({ libraryId, actor, action, target: { type: 'test', id: 't1' }, details });
}

describe('audit log', () => {
  it('chains entries and verifies the chain', async () => {
    const first = await record('book.issued', { copy: 'c1' });
    const second = await record('book.returned', { copy: 'c1' });
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(second.prevHash).toBe(first.hash);
    expect(second.actorId?.toString()).toBe(String(actor.id));
    expect(await verifyAuditChain(libraryId)).toBeNull();
  });

  it('keeps one unbroken chain under concurrent writes', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => record('cash.recorded', { i })));
    const seqs = await runWithTenant(libraryId, () =>
      AuditLogModel.find().sort({ seq: 1 }).distinct('seq'),
    );
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await verifyAuditChain(libraryId)).toBeNull();
  });

  it('rejects every update and delete path', async () => {
    const entry = await record('payment.cash');
    const inTenant = <T>(fn: () => T | PromiseLike<T>) => runWithTenant(libraryId, fn);
    const attempts: [string, () => unknown][] = [
      ['updateOne', () => AuditLogModel.updateOne({ _id: entry._id }, { action: 'x' })],
      ['updateMany', () => AuditLogModel.updateMany({}, { action: 'x' })],
      ['replaceOne', () => AuditLogModel.replaceOne({ _id: entry._id }, {})],
      [
        'findOneAndUpdate',
        () => AuditLogModel.findOneAndUpdate({ _id: entry._id }, { action: 'x' }),
      ],
      ['findOneAndDelete', () => AuditLogModel.findOneAndDelete({ _id: entry._id })],
      ['deleteOne', () => AuditLogModel.deleteOne({ _id: entry._id })],
      ['deleteMany', () => AuditLogModel.deleteMany({})],
      ['bulkWrite', () => AuditLogModel.bulkWrite([{ deleteOne: { filter: {} } }])],
      [
        'doc.save',
        async () => {
          const doc = await AuditLogModel.findById(entry._id);
          doc!.action = 'tampered';
          await doc!.save();
        },
      ],
      [
        'doc.deleteOne',
        async () => {
          const doc = await AuditLogModel.findById(entry._id);
          await doc!.deleteOne();
        },
      ],
    ];
    const allowed: string[] = [];
    for (const [name, attempt] of attempts) {
      try {
        await inTenant(attempt);
        allowed.push(name);
      } catch {
        // expected
      }
    }
    expect(allowed).toEqual([]);
    const after = await inTenant(() => AuditLogModel.findById(entry._id).lean());
    expect(after?.action).toBe('payment.cash');
  });

  it('detects tampering done outside the application', async () => {
    await record('a');
    await record('b');
    await record('c');
    // Bypass Mongoose entirely, as someone with raw database access would.
    await mongoose.connection
      .collection('auditLogs')
      .updateOne({ libraryId, seq: 2 }, { $set: { action: 'edited' } });
    expect(await verifyAuditChain(libraryId)).toBe(2);
  });
});
