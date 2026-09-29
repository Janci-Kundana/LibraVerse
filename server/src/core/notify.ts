import { sendMail } from './mailer';

export interface Notice {
  /** stable kind, e.g. 'loan.dueSoon', used for in-app filtering and push */
  type: string;
  subject: string;
  text: string;
}

export interface Recipient {
  libraryId: string;
  userId: string;
  email: string;
}

type Channel = (to: Recipient, notice: Notice) => Promise<void>;

const emailChannel: Channel = (to, n) =>
  sendMail({ to: to.email, subject: n.subject, text: n.text });

// Later phases register more channels (in-app, web push, SMS).
const channels: Channel[] = [emailChannel];

export function registerChannel(channel: Channel) {
  channels.push(channel);
}

/**
 * Sends a notice on every channel. One failing channel never blocks the rest
 * or the business action that triggered it.
 */
export async function notify(to: Recipient, notice: Notice): Promise<void> {
  const results = await Promise.allSettled(channels.map((send) => send(to, notice)));
  for (const r of results) {
    if (r.status === 'rejected') console.error(`notify ${notice.type} failed:`, r.reason);
  }
}
