import { Schema, model, type InferSchemaType } from 'mongoose';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// A browser's Web Push subscription for one user (FR-24).
const pushSubscriptionSchema = new Schema(
  {
    libraryId: libraryIdPath,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true },
);

pushSubscriptionSchema.plugin(tenantPlugin);
pushSubscriptionSchema.index({ libraryId: 1, endpoint: 1 }, { unique: true });

export type PushSubscriptionDoc = InferSchemaType<typeof pushSubscriptionSchema>;
export const PushSubscriptionModel = model(
  'PushSubscription',
  pushSubscriptionSchema,
  'pushSubscriptions',
);
