import webpush from 'web-push';
import { Types } from 'mongoose';
import { z } from 'zod';
import { env } from '../../config/env';
import { registerChannel, type Notice, type Recipient } from '../../core/notify';
import { runWithTenant } from '../../core/tenant';
import { PushSubscriptionModel } from './model';

export const subscribeBody = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const pushEnabled = () => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

type Sender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;
let send: Sender = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 60 * 60 });

/** Tests replace the network call. */
export function setPushSender(s?: Sender) {
  send = s ?? ((sub, payload) => webpush.sendNotification(sub, payload, { TTL: 24 * 60 * 60 }));
}

export async function subscribe(userId: string, input: z.infer<typeof subscribeBody>) {
  await PushSubscriptionModel.findOneAndUpdate(
    { endpoint: input.endpoint },
    { $set: { userId: new Types.ObjectId(userId), keys: input.keys } },
    { upsert: true },
  );
}

export async function unsubscribe(userId: string, endpoint: string) {
  await PushSubscriptionModel.deleteOne({ endpoint, userId: new Types.ObjectId(userId) });
}

/** notify() channel: pushes to every browser the user subscribed. */
async function pushChannel(to: Recipient, notice: Notice) {
  if (!pushEnabled() && env.NODE_ENV !== 'test') return;
  await runWithTenant(to.libraryId, async () => {
    const subs = await PushSubscriptionModel.find({ userId: new Types.ObjectId(to.userId) }).lean();
    const payload = JSON.stringify({
      title: notice.subject,
      body: notice.text.slice(0, 240),
      type: notice.type,
    });
    for (const s of subs) {
      try {
        await send({ endpoint: s.endpoint, keys: s.keys! }, payload);
      } catch (err) {
        // 404/410: the browser unsubscribed; forget it.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await PushSubscriptionModel.deleteOne({ _id: s._id });
      }
    }
  });
}

let registered = false;
export function registerPushChannel() {
  if (registered) return;
  registered = true;
  if (pushEnabled())
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  registerChannel(pushChannel);
}
