import { Schema, model } from 'mongoose';

// Platform-level de-duplication of Razorpay webhook deliveries (Razorpay retries
// on timeouts). Keyed by the x-razorpay-event-id header; kept 30 days.
const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  source: { type: String, required: true }, // 'library:<id>' or 'platform'
  receivedAt: { type: Date, required: true, default: () => new Date() },
});

webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEventModel = model('WebhookEvent', webhookEventSchema, 'webhookEvents');
