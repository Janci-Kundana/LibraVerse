import { Types } from 'mongoose';
import { registerChannel, type Notice, type Recipient } from '../../core/notify';
import { parseId } from '../../core/ids';
import { runWithTenant } from '../../core/tenant';
import { emitToUser } from '../../realtime/io';
import { NotificationModel } from './model';

async function inAppChannel(to: Recipient, n: Notice) {
  const doc = await runWithTenant(to.libraryId, () =>
    NotificationModel.create({
      userId: new Types.ObjectId(to.userId),
      type: n.type,
      title: n.subject,
      message: n.text.slice(0, 1000),
    }),
  );
  emitToUser(to.userId, 'notification:new', {
    id: String(doc._id),
    title: doc.title,
    type: doc.type,
  });
}

let registered = false;
export function registerInAppChannel() {
  if (registered) return;
  registered = true;
  registerChannel(inAppChannel);
}

export async function mine(userId: string) {
  const uid = new Types.ObjectId(userId);
  const [items, unread] = await Promise.all([
    NotificationModel.find({ userId: uid }).sort({ createdAt: -1 }).limit(50).lean(),
    NotificationModel.countDocuments({ userId: uid, read: false }),
  ]);
  return {
    unread,
    items: items.map((n) => ({
      id: String(n._id),
      type: n.type,
      title: n.title,
      message: n.message,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function markRead(userId: string, id?: string) {
  await NotificationModel.updateMany(
    { userId: new Types.ObjectId(userId), ...(id ? { _id: parseId(id, 'Notification') } : {}) },
    { $set: { read: true } },
  );
}
