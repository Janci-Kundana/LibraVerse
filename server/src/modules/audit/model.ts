import { Schema, model, Types, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';
import { AppError } from '../../core/errors';

// Append-only: each entry is chained to the previous one in its library by
// `prevHash`, and every update or delete path on the model throws.
const auditLogSchema = new Schema(
  {
    libraryId: libraryIdPath,
    seq: { type: Number, required: true },
    actorId: { type: Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    action: { type: String, required: true },
    target: {
      type: new Schema(
        { type: { type: String, required: true }, id: { type: String, required: true } },
        { _id: false },
      ),
      required: true,
    },
    details: { type: Schema.Types.Mixed, default: {} },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  // minimize: false keeps an empty `details` object, which the hash covers.
  { versionKey: false, minimize: false },
);

auditLogSchema.plugin(tenantPlugin);
auditLogSchema.index({ libraryId: 1, seq: 1 }, { unique: true });
auditLogSchema.index({ libraryId: 1, createdAt: -1 });

class AuditLogImmutableError extends AppError {
  constructor() {
    super(500, 'AUDIT_IMMUTABLE', 'Audit log entries cannot be changed or deleted');
  }
}

const reject = () => {
  throw new AuditLogImmutableError();
};

for (const op of [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const) {
  auditLogSchema.pre(op, reject);
}
auditLogSchema.pre('deleteOne', { document: true, query: false }, reject);
auditLogSchema.pre('updateOne', { document: true, query: false }, reject);
auditLogSchema.pre('bulkWrite', reject);
auditLogSchema.pre('save', function () {
  if (!this.isNew) reject();
});

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = model('AuditLog', auditLogSchema, 'auditLogs');
