import { Schema, model, type InferSchemaType } from 'mongoose';
import { LIBRARY_STATUSES } from '@libraverse/shared';

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
    // Filled in Phase 5; razorpaySecret and the webhook secret are stored encrypted.
    razorpayKeyId: { type: String, default: null },
  },
  { timestamps: true },
);

export type Library = InferSchemaType<typeof librarySchema>;
export const LibraryModel = model('Library', librarySchema, 'libraries');
