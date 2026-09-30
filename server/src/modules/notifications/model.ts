import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// In-app notification centre (FR-24).
const notificationSchema = new Schema(
  {
    libraryId: libraryIdPath,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, default: 'inApp' },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.plugin(tenantPlugin);
notificationSchema.index({ libraryId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

export type Notification = InferSchemaType<typeof notificationSchema>;
export const NotificationModel = model('Notification', notificationSchema, 'notifications');
