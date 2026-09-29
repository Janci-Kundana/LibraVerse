import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES, USER_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

const OTP_PURPOSES = ['login', 'reset'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

// Every login account. libraryId is null only for the Super Admin. The same
// email may hold accounts in several libraries, so email is unique per library.
const userSchema = new Schema(
  {
    libraryId: { ...libraryIdPath, required: false, default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: ROLES, required: true },
    branchId: { type: Types.ObjectId, ref: 'Branch', default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    status: { type: String, enum: USER_STATUSES, default: 'invited' },
    otp: {
      type: new Schema(
        {
          purpose: { type: String, enum: OTP_PURPOSES, required: true },
          codeHash: { type: String, required: true },
          expiresAt: { type: Date, required: true },
          attempts: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: null,
      select: false,
    },
    passwordSetup: {
      type: new Schema(
        { tokenHash: { type: String, required: true }, expiresAt: { type: Date, required: true } },
        { _id: false },
      ),
      default: null,
      select: false,
    },
  },
  { timestamps: true },
);

userSchema.plugin(tenantPlugin);
userSchema.index({ libraryId: 1, email: 1 }, { unique: true });
userSchema.index({ email: 1 });
userSchema.index({ 'passwordSetup.tokenHash': 1 }, { sparse: true });

userSchema.path('role').validate(function (role: string) {
  return (role === 'superAdmin') === (this.get('libraryId') == null);
}, 'Only the Super Admin has no library, and the Super Admin has none');

export type User = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema, 'users');
