import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Types } from 'mongoose';
import type { Role } from '@libraverse/shared';
import { runWithTenant } from '../../core/tenant';
import { AuditLogModel } from './model';

export interface AuditEntry {
  libraryId: Types.ObjectId | string;
  actor: { id: Types.ObjectId | string; role: Role } | null;
  action: string;
  target: { type: string; id: Types.ObjectId | string };
  details?: Record<string, unknown>;
}

const GENESIS = '0'.repeat(64);
const MAX_ATTEMPTS = 20;

function hashEntry(fields: {
  libraryId: string;
  seq: number;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: unknown;
  createdAt: string;
  prevHash: string;
}): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/**
 * Appends an entry to the library's audit chain. Runs in that library's tenant
 * context, so a system caller (e.g. Super Admin approving a library) can use it.
 */
export function recordAudit(entry: AuditEntry) {
  return runWithTenant(entry.libraryId, async () => {
    for (let attempt = 1; ; attempt++) {
      const last = await AuditLogModel.findOne().sort({ seq: -1 }).select('seq hash').lean();
      const seq = (last?.seq ?? 0) + 1;
      const prevHash = last?.hash ?? GENESIS;
      const createdAt = new Date();
      const details = entry.details ?? {};
      const actorId = entry.actor ? String(entry.actor.id) : null;
      const hash = hashEntry({
        libraryId: String(entry.libraryId),
        seq,
        actorId,
        action: entry.action,
        targetType: entry.target.type,
        targetId: String(entry.target.id),
        details,
        createdAt: createdAt.toISOString(),
        prevHash,
      });
      try {
        return await AuditLogModel.create({
          seq,
          actorId,
          actorRole: entry.actor?.role ?? null,
          action: entry.action,
          target: { type: entry.target.type, id: String(entry.target.id) },
          details,
          prevHash,
          hash,
          createdAt,
        });
      } catch (err) {
        // Another writer took this seq; re-read the chain head and retry.
        const duplicate = (err as { code?: unknown }).code === 11000;
        if (!duplicate || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(Math.random() * 5 * attempt);
      }
    }
  });
}

/** Recomputes the chain for the current tenant; returns the first broken seq, or null. */
export async function verifyAuditChain(libraryId: Types.ObjectId | string): Promise<number | null> {
  return runWithTenant(libraryId, async () => {
    let prevHash = GENESIS;
    const cursor = AuditLogModel.find().sort({ seq: 1 }).lean().cursor();
    for await (const e of cursor) {
      const expected = hashEntry({
        libraryId: String(e.libraryId),
        seq: e.seq,
        actorId: e.actorId ? String(e.actorId) : null,
        action: e.action,
        targetType: e.target.type,
        targetId: e.target.id,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
        prevHash,
      });
      if (e.prevHash !== prevHash || e.hash !== expected) return e.seq;
      prevHash = e.hash;
    }
    return null;
  });
}
