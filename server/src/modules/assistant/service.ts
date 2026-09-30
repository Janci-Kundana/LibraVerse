import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { env } from '../../config/env';
import { AppError } from '../../core/errors';
import { BookModel } from '../books/model';
import { copyCounts, searchFilter } from '../books/service';
import { circulationSettings, rupees } from '../circulation/rules';
import { memberLoans } from '../circulation/service';
import { LibraryModel } from '../libraries/model';
import { MembershipPlanModel } from '../membershipPlans/model';

// FR-25: a member asks about books, rules and fines. Claude answers using tools
// that read only this library's data (every query runs in the member's tenant
// context) and only this member's own account.

const MODEL = 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 5;

export const chatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[m.length - 1]!.role === 'user', 'the last message must be from the user'),
});

type Client = Pick<Anthropic, 'beta'>;
let client: Client | null = null;

/** Tests inject a fake client. */
export function setAssistantClient(c: Client | null) {
  client = c;
}

export const assistantEnabled = () => Boolean(client ?? env.ANTHROPIC_API_KEY);

function getClient(): Client {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY)
    throw new AppError(503, 'ASSISTANT_OFF', 'The library assistant is not set up yet');
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_catalog',
    description:
      "Search this library's catalog by title, author, ISBN or topic. Returns up to 8 books with how many copies are on the shelf now. Use it for any question about whether a book is available or for suggestions.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Title, author, ISBN, or a topic word such as "history"',
        },
        category: { type: 'string', description: 'Optional exact category to filter by' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_library_rules',
    description:
      'The borrowing rules: loan period, renewals, reservation hold time, lost-book charge, and every membership plan with its price, book limit and late fine per day.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'get_my_account',
    description:
      "The signed-in member's own books on loan (with due dates and fines so far), unpaid fines, and reservations.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
];

/** Runs one of the member tools above in the caller's tenant context. */
export async function runMemberTool(
  name: string,
  input: unknown,
  memberId: string,
  libraryId: string,
): Promise<string> {
  if (name === 'search_catalog') {
    const { query, category } = z
      .object({ query: z.string().max(100), category: z.string().max(60).optional() })
      .parse(input);
    const words = query.split(/\s+/).filter((w) => w.length > 2);
    const byText = await BookModel.find({
      ...searchFilter(query),
      ...(category ? { category } : {}),
    })
      .limit(8)
      .lean();
    const byTopic =
      byText.length > 0 || words.length === 0
        ? []
        : await BookModel.find({
            $or: words.map((w) => ({
              category: { $regex: w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
            })),
          })
            .sort({ borrowCount: -1 })
            .limit(8)
            .lean();
    const books = byText.length ? byText : byTopic;
    const counts = await copyCounts(books.map((b) => b._id));
    if (books.length === 0) return 'No books in this library match that search.';
    return JSON.stringify(
      books.map((b) => ({
        title: b.title,
        authors: b.authors,
        category: b.category,
        language: b.language,
        onShelf: counts.get(String(b._id))?.available ?? 0,
        totalCopies: counts.get(String(b._id))?.total ?? 0,
        rating: b.ratingAvg,
      })),
    );
  }
  if (name === 'get_library_rules') {
    const [rules, plans] = await Promise.all([
      circulationSettings(libraryId),
      MembershipPlanModel.find({ active: true }).sort({ price: 1 }).lean(),
    ]);
    return JSON.stringify({
      loanDays: rules.loanDays,
      renewalsAllowed: rules.maxRenewals,
      reservationHoldDays: rules.holdDays,
      lostBookCharge: rupees(rules.lostBookCharge),
      plans: plans.map((p) => ({
        name: p.name,
        price: rupees(p.price),
        days: p.durationDays,
        booksAtATime: p.bookLimit,
        lateFinePerDay: rupees(p.finePerDay),
      })),
    });
  }
  if (name === 'get_my_account') {
    const mine = await memberLoans(memberId);
    return JSON.stringify({
      unpaidFines: rupees(mine.pendingDues),
      borrowed: mine.current.map((l) => ({
        title: l.bookTitle,
        due: l.dueAt.slice(0, 10),
        daysOverdue: l.overdueDays,
        fineSoFar: rupees(l.fineAmount),
        renewalsUsed: l.renewals,
      })),
    });
  }
  return `Unknown tool ${name}`;
}

/** One assistant reply. Runs in the member's tenant context. */
export async function chat(
  libraryId: string,
  memberId: string,
  messages: z.infer<typeof chatBody>['messages'],
) {
  const library = await LibraryModel.findById(libraryId).select('name').lean();
  const system = `You are the friendly assistant of ${library?.name ?? 'the library'} on LibraVerse, talking with a library member.
Answer questions about books in this library's catalog, borrowing rules, fines and the member's own account, using the tools; never guess availability, prices, dates or fines.
Money is in Indian rupees. Keep answers short and practical (a few sentences or a short list). Today is ${new Date().toISOString().slice(0, 10)}.
You cannot issue, renew, reserve or pay for anything yourself: tell the member where to do it in the app (My books, Catalog, Payments) or at the counter.
If asked about something unrelated to the library, say briefly that you can only help with library questions.`;
  return converse({
    system,
    tools: TOOLS,
    messages,
    runTool: (name, input) => runMemberTool(name, input, memberId, libraryId),
    refusal: 'Sorry, I can’t help with that. Ask me about books, borrowing or fines.',
    noAnswer: 'Sorry, I could not find an answer. Please ask at the counter.',
  });
}

/**
 * The tool loop shared by the assistant and the in-app guide: ask Claude, run
 * the tools it calls (read-only lookups), and repeat until it answers.
 */
export async function converse(opts: {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: { role: 'user' | 'assistant'; content: string }[];
  runTool: (name: string, input: unknown) => Promise<string>;
  refusal: string;
  noAnswer: string;
}) {
  const anthropic = getClient();
  const convo: Anthropic.Beta.BetaMessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: opts.system,
      ...(opts.tools.length ? { tools: opts.tools } : {}),
      output_config: { effort: 'low' },
      // Server-side refusal fallback: a declined request is retried on the
      // fallback model chosen by category.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: convo,
    });

    if (response.stop_reason === 'refusal') return { reply: opts.refusal };
    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
    );
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0 || round === MAX_TOOL_ROUNDS) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: text || opts.noAnswer };
    }

    convo.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      try {
        results.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: await opts.runTool(tool.name, tool.input),
        });
      } catch {
        results.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: 'That lookup failed.',
          is_error: true,
        });
      }
    }
    convo.push({ role: 'user', content: results });
  }
  return { reply: 'Sorry, I could not finish that. Please try a simpler question.' };
}
