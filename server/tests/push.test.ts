import { createApp } from '../src/app';
import { runWithTenant } from '../src/core/tenant';
import { notify } from '../src/core/notify';
import { PushSubscriptionModel } from '../src/modules/push/model';
import { setPushSender } from '../src/modules/push/service';
import { createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

describe('web push (FR-24)', () => {
  it('stores a subscription and pushes notices to it; gone endpoints are forgotten', async () => {
    const lib = await createLibrary('city');
    const user = await createUser({ libraryId: lib.id, role: 'member', email: 'reader@city.test' });
    const agent = await signedInAgent(app, 'reader@city.test');
    const sub = {
      endpoint: 'https://push.example/abc',
      keys: { p256dh: 'BPp256dh-key-value', auth: 'auth-secret' },
    };
    expect((await agent.post('/api/push/subscribe').send(sub)).status).toBe(204);

    const sent: string[] = [];
    setPushSender(async (s, payload) => {
      sent.push(`${s.endpoint} ${JSON.parse(payload).title}`);
    });
    await notify(
      { libraryId: lib.id, userId: String(user._id), email: 'reader@city.test' },
      { type: 't', subject: 'Book ready', text: 'Come get it' },
    );
    expect(sent).toEqual(['https://push.example/abc Book ready']);

    setPushSender(async () => {
      throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    await notify(
      { libraryId: lib.id, userId: String(user._id), email: 'reader@city.test' },
      { type: 't', subject: 'x', text: 'y' },
    );
    expect(await runWithTenant(lib.id, () => PushSubscriptionModel.countDocuments())).toBe(0);
    setPushSender();
  });
});
