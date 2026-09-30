import request from 'supertest';
import type Anthropic from '@anthropic-ai/sdk';
import { createApp } from '../src/app';
import { setAssistantClient } from '../src/modules/assistant/service';
import { activeMember, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

type Params = Anthropic.Beta.MessageCreateParams;

/**
 * A fake Claude: the first call asks for `tool` (when given), then it answers
 * with `reply`. Every request is recorded.
 */
function fakeClaude(reply: string, tool?: string) {
  const requests: Params[] = [];
  setAssistantClient({
    beta: {
      messages: {
        create: async (params: Params) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          if (tool && requests.length === 1) {
            return {
              stop_reason: 'tool_use',
              content: [{ type: 'tool_use', id: 't1', name: tool, input: {} }],
            };
          }
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: reply }] };
        },
      },
    },
  } as unknown as Anthropic);
  return requests;
}

const ask = (page: string, content = 'How do I issue a book?') => ({
  page,
  messages: [{ role: 'user', content }],
});
const toolNames = (p: Params) => (p.tools ?? []).map((t) => (t as { name: string }).name);

afterEach(() => setAssistantClient(null));

describe('in-app guide', () => {
  it('needs a signed-in user and is off without an API key', async () => {
    expect((await request(app).get('/api/guide/status')).status).toBe(401);
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');
    expect((await staff.get('/api/guide/status')).body).toEqual({ enabled: false });
    expect((await staff.post('/api/guide').send(ask('/library/counter'))).status).toBe(503);
  });

  it('rejects a page that is not an app path', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');
    fakeClaude('hi');
    const res = await staff.post('/api/guide').send(ask('https://evil.test/x'));
    expect(res.status).toBe(400);
  });

  it('a member gets the member guide, their own tools, and only safe links', async () => {
    const lib = await createLibrary('city');
    const m = await activeMember(app, lib.id, 'reader@city.test');
    const requests = fakeClaude(
      'Show your [card](/member/card) at the [Counter](/library/counter). More at [help](https://evil.test).',
    );
    const res = await m.agent.post('/api/guide').send(ask('/member/card', 'How do I borrow?'));
    expect(res.status).toBe(200);
    // Staff pages and outside links are reduced to plain text.
    expect(res.body.reply).toBe('Show your [card](/member/card) at the Counter. More at help.');

    const system = String(requests[0]!.system);
    expect(system).toContain('a library member of');
    expect(system).toContain('the "My card" page (/member/card)');
    expect(system).not.toContain('/library/counter');
    expect(toolNames(requests[0]!)).toEqual([
      'search_catalog',
      'get_library_rules',
      'get_my_account',
    ]);
  });

  it('a librarian sees what needs attention in their own library only', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    await activeMember(app, lib.id, 'reader@city.test');
    // Another library's members must not be counted.
    const other = await createLibrary('town');
    await activeMember(app, other.id, 'reader@town.test');
    await activeMember(app, other.id, 'second@town.test');

    const staff = await signedInAgent(app, 'staff@city.test');
    const requests = fakeClaude(
      'Start with the [Counter](/library/counter).',
      'get_library_status',
    );
    const res = await staff.post('/api/guide').send(ask('/library', 'What should I do first?'));
    expect(res.body.reply).toBe('Start with the [Counter](/library/counter).');

    expect(toolNames(requests[0]!)).toEqual([
      'search_catalog',
      'get_library_rules',
      'get_library_status',
    ]);
    // Admin-only pages are not in a librarian's guide.
    expect(String(requests[0]!.system)).not.toContain('/library/settings');
    const status = JSON.stringify(requests[1]!.messages.at(-1));
    expect(status).toContain('\\"members\\":1');
    expect(status).toContain('\\"depositRefundRequests\\":0');
  });

  it('a librarian cannot use the member-account tool even if Claude asks for it', async () => {
    const lib = await createLibrary('city');
    await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
    const staff = await signedInAgent(app, 'staff@city.test');
    const requests = fakeClaude('ok', 'get_my_account');
    await staff.post('/api/guide').send(ask('/library'));
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('Unknown tool get_my_account');
  });

  it('the Super Admin gets the platform guide and no data tools', async () => {
    await createUser({ libraryId: null, role: 'superAdmin', email: 'root@platform.test' });
    const admin = await signedInAgent(app, 'root@platform.test');
    const requests = fakeClaude('Approve it on [Libraries](/admin).', 'get_library_status');
    const res = await admin.post('/api/guide').send(ask('/admin', 'How do I approve a library?'));
    expect(res.body.reply).toBe('Approve it on [Libraries](/admin).');
    expect(requests[0]!.tools).toBeUndefined();
    expect(String(requests[0]!.system)).toContain('Super Admin');
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain('Unknown tool');
  });
});
