import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

export const DONATION_STATUSES = ['offered', 'accepted', 'declined', 'catalogued'] as const;

// A book offered by a visitor or member (FR-03).
const donationSchema = new Schema(
  {
    libraryId: libraryIdPath,
    donorName: { type: String, required: true, trim: true },
    donorEmail: { type: String, required: true, lowercase: true, trim: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    anonymous: { type: Boolean, default: false },
    title: { type: String, required: true, trim: true },
    author: { type: String, default: '', trim: true },
    condition: { type: String, enum: ['new', 'good', 'fair', 'worn'], required: true },
    message: { type: String, default: '' },
    status: { type: String, enum: DONATION_STATUSES, default: 'offered' },
    staffNote: { type: String, default: null },
    bookId: { type: Schema.Types.ObjectId, ref: 'Book', default: null },
  },
  { timestamps: true },
);

donationSchema.plugin(tenantPlugin);
donationSchema.index({ libraryId: 1, status: 1, createdAt: -1 });

export type Donation = InferSchemaType<typeof donationSchema>;
export const DonationModel = model('Donation', donationSchema, 'donations');
