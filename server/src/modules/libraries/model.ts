import { Schema, model, type InferSchemaType } from 'mongoose';
import { LIBRARY_STATUSES } from '@libraverse/shared';

const encryptedValue = new Schema(
  {
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    data: { type: String, required: true },
  },
  { _id: false },
);

// Platform-level: one record per tenant. Holds only library-level facts, so the
// Super Admin can manage libraries without reading their users.
const librarySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    logoUrl: { type: String, default: null },
    cardColours: { type: [String], default: [] },
    status: { type: String, enum: LIBRARY_STATUSES, default: 'pending', index: true },
    statusReason: { type: String, default: null },
    // Each library's own Razorpay account (test mode). Secrets are AES-256-GCM
    // encrypted, never selected by default, and never returned by the API.
    razorpayKeyId: { type: String, default: null },
    razorpayKeySecret: { type: encryptedValue, default: null, select: false },
    razorpayWebhookSecret: { type: encryptedValue, default: null, select: false },
    circulation: {
      type: new Schema(
        {
          loanDays: { type: Number, default: 14, min: 1, max: 180 },
          maxRenewals: { type: Number, default: 2, min: 0, max: 10 },
          holdDays: { type: Number, default: 3, min: 1, max: 30 },
          lostBookCharge: { type: Number, default: 50_000, min: 0 }, // paise
          // Security deposit every member pays (same for all plans), paise, at least ₹1.
          depositAmount: { type: Number, default: 50_000, min: 100 },
          // Unpaid dues: a warning every N days (3 warnings), then the deduction
          // this many days after the third warning (notice the day before).
          warningIntervalDays: { type: Number, default: 3, min: 1, max: 30 },
          deductionGraceDays: { type: Number, default: 4, min: 2, max: 60 },
        },
        { _id: false },
      ),
      default: () => ({}),
    },
  },
  { timestamps: true },
);

export type Library = InferSchemaType<typeof librarySchema>;
export const LibraryModel = model('Library', librarySchema, 'libraries');
