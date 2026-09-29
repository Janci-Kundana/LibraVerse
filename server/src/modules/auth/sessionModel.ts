import { Schema, model, Types, type InferSchemaType } from 'mongoose';

// Auth infrastructure keyed by user, not tenant data: one document per login
// (a refresh-token family). Each refresh rotates `jtiHash`; presenting an old
// token again revokes the whole family.
const sessionSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    jtiHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export const SessionModel = model('Session', sessionSchema, 'sessions');
