import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// Notice board: events (with a date) and announcements.
const eventSchema = new Schema(
  {
    libraryId: libraryIdPath,
    kind: { type: String, enum: ['event', 'announcement'], default: 'event' },
    title: { type: String, required: true, trim: true },
    date: { type: Date, default: null },
    description: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

eventSchema.plugin(tenantPlugin);
eventSchema.index({ libraryId: 1, date: 1 });

export type LibraryEvent = InferSchemaType<typeof eventSchema>;
export const EventModel = model('Event', eventSchema, 'events');
