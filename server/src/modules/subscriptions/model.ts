import { Schema, model, type InferSchemaType } from 'mongoose';
import { SUBSCRIPTION_STATUSES } from '@libraverse/shared';
import { libraryIdPath, tenantPlugin } from '../../core/tenant';

// A library's platform plan. Billing (Pro, renewals) arrives in Phase 7.
const subscriptionSchema = new Schema(
  {
    libraryId: libraryIdPath,
    platformPlanId: { type: Schema.Types.ObjectId, ref: 'PlatformPlan', required: true },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'pending' },
    currentPeriodEnd: { type: Date, default: null },
    razorpaySubscriptionId: { type: String, default: null },
  },
  { timestamps: true },
);

subscriptionSchema.plugin(tenantPlugin);

export type Subscription = InferSchemaType<typeof subscriptionSchema>;
export const SubscriptionModel = model('Subscription', subscriptionSchema, 'subscriptions');
