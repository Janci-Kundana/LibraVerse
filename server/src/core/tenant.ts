import { AsyncLocalStorage } from 'node:async_hooks';
import { Schema, Types } from 'mongoose';
import { AppError } from './errors';

// Every tenant-owned query runs inside one of these contexts. A request gets a
// tenant context from `authenticate`; code that must see across libraries
// (Super Admin totals, auth lookups before the tenant is known, webhooks, cron)
// opts in with `runAsSystem` and a reason.
type Context = { kind: 'tenant'; libraryId: Types.ObjectId } | { kind: 'system'; reason: string };

const storage = new AsyncLocalStorage<Context>();

// `fn` is awaited inside the context: a Mongoose Query is lazy and only runs
// when awaited, so returning one unawaited would execute it outside.
export function runWithTenant<T>(
  libraryId: Types.ObjectId | string,
  fn: () => T | PromiseLike<T>,
): Promise<T> {
  return storage.run({ kind: 'tenant', libraryId: new Types.ObjectId(libraryId) }, async () =>
    fn(),
  );
}

export function runAsSystem<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run({ kind: 'system', reason }, async () => fn());
}

/** For request middleware: runs `next` (synchronously) inside the tenant context. */
export function enterTenant(libraryId: string, next: () => void): void {
  storage.run({ kind: 'tenant', libraryId: new Types.ObjectId(libraryId) }, next);
}

export function currentLibraryId(): Types.ObjectId | undefined {
  const ctx = storage.getStore();
  return ctx?.kind === 'tenant' ? ctx.libraryId : undefined;
}

export class TenantContextError extends AppError {
  constructor(message: string) {
    super(500, 'TENANT_CONTEXT', message);
    this.name = 'TenantContextError';
  }
}

function requireContext(model: string): Context {
  const ctx = storage.getStore();
  if (!ctx)
    throw new TenantContextError(`${model}: tenant-scoped operation without a tenant context`);
  return ctx;
}

const FILTERED_QUERIES = [
  'find',
  'findOne',
  'countDocuments',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
] as const;

const UPDATES = new Set<string>([
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
]);

function sameId(a: unknown, b: Types.ObjectId): boolean {
  return a != null && String(a) === String(b);
}

/** Rejects an update that would move a document to another library. */
function assertUpdateKeepsTenant(update: unknown, libraryId: Types.ObjectId, model: string) {
  if (!update || typeof update !== 'object') return;
  const u = update as Record<string, unknown>;
  const candidates = [u.libraryId, (u.$set as Record<string, unknown> | undefined)?.libraryId];
  for (const value of candidates) {
    if (value !== undefined && !sameId(value, libraryId)) {
      throw new TenantContextError(`${model}: an update may not change libraryId`);
    }
  }
  if ((u.$unset as Record<string, unknown> | undefined)?.libraryId !== undefined) {
    throw new TenantContextError(`${model}: an update may not unset libraryId`);
  }
}

/** Spread into a tenant schema's definition (declared there so its type is inferred). */
export const libraryIdPath = {
  type: Schema.Types.ObjectId,
  ref: 'Library',
  required: true,
  index: true,
  immutable: true,
} as const;

/**
 * Scopes every read, write and aggregate on the schema to the current tenant,
 * and throws when there is no tenant or system context. The schema must declare
 * `libraryId: libraryIdPath`.
 */
export function tenantPlugin(schema: Schema) {
  if (!schema.path('libraryId')) {
    throw new Error('tenantPlugin: the schema must declare libraryId (use libraryIdPath)');
  }

  for (const op of FILTERED_QUERIES) {
    schema.pre(op, function () {
      const ctx = requireContext(this.model.modelName);
      if (ctx.kind === 'system') return;
      // $and (rather than overwriting libraryId) so a filter naming another
      // library matches nothing instead of silently being rewritten.
      this.and([{ libraryId: ctx.libraryId }]);
      if (UPDATES.has(op))
        assertUpdateKeepsTenant(this.getUpdate(), ctx.libraryId, this.model.modelName);
    });
  }

  schema.pre('estimatedDocumentCount', function () {
    const ctx = requireContext(this.model.modelName);
    if (ctx.kind === 'tenant') {
      throw new TenantContextError(
        `${this.model.modelName}: use countDocuments in a tenant context`,
      );
    }
  });

  schema.pre('aggregate', function () {
    const ctx = requireContext(this.model().modelName);
    if (ctx.kind === 'system') return;
    this.pipeline().unshift({ $match: { libraryId: ctx.libraryId } });
  });

  // Validation runs before pre('save'), so the default is filled in here.
  schema.pre('validate', function () {
    const ctx = storage.getStore();
    if (ctx?.kind === 'tenant' && this.isNew && this.get('libraryId') == null) {
      this.set('libraryId', ctx.libraryId);
    }
  });

  schema.pre('save', function () {
    const model = (this.constructor as unknown as { modelName: string }).modelName;
    const ctx = requireContext(model);
    if (ctx.kind === 'system') return;
    if (!sameId(this.get('libraryId'), ctx.libraryId)) {
      throw new TenantContextError(`${model}: document belongs to another library`);
    }
  });

  schema.pre('insertMany', function (next, docs: unknown) {
    const ctx = requireContext(this.modelName);
    if (ctx.kind === 'tenant') {
      for (const doc of Array.isArray(docs) ? docs : [docs]) {
        const d = doc as { libraryId?: unknown };
        if (d.libraryId == null) d.libraryId = ctx.libraryId;
        else if (!sameId(d.libraryId, ctx.libraryId)) {
          throw new TenantContextError(`${this.modelName}: document belongs to another library`);
        }
      }
    }
    next();
  });

  schema.pre('bulkWrite', function (next) {
    const ctx = requireContext(this.modelName);
    if (ctx.kind === 'tenant') {
      throw new TenantContextError(
        `${this.modelName}: bulkWrite is not tenant-scoped; use system context`,
      );
    }
    next();
  });
}
