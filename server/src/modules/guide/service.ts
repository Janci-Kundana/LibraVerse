import type Anthropic from '@anthropic-ai/sdk';
import { GUIDE, guideFor, isGuidePath, type Role } from '@libraverse/shared';
import { converse, runMemberTool, TOOLS } from '../assistant/service';
import { LibraryModel } from '../libraries/model';
import { MemberProfileModel } from '../members/model';
import { libraryDashboard } from '../reports/service';
import { ReservationModel } from '../reservations/model';
import type { GuideBody } from './validation';

// The in-app guide: answers "how do I…?" for every role, using the page map
// in shared/guide.ts plus read-only lookups. It never acts (no payments,
// approvals or refunds) and links only to pages the role can open. Staff and
// members run in their tenant context; the Super Admin gets no data tools, so
// it never sees any library's records.

const ROLE_NAMES: Record<Role, string> = {
  superAdmin: 'the LibraVerse platform admin (Super Admin)',
  libraryAdmin: 'a library admin',
  librarian: 'a librarian',
  member: 'a library member',
};

const STATUS_TOOL: Anthropic.Beta.BetaTool = {
  name: 'get_library_status',
  description:
    "What needs attention in this library right now: members, ID checks waiting, books on loan, overdue loans, unpaid fines, deposit refund requests and reservations waiting. Use it for questions like 'what should I do first today?'.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
  strict: true,
};

function toolsFor(role: Role): Anthropic.Beta.BetaTool[] {
  if (role === 'member') return TOOLS;
  if (role === 'superAdmin') return [];
  return [...TOOLS.filter((t) => t.name !== 'get_my_account'), STATUS_TOOL];
}

async function libraryStatus() {
  const [dash, refunds, reservations] = await Promise.all([
    libraryDashboard(),
    MemberProfileModel.countDocuments({ 'depositRefund.status': 'requested' }),
    ReservationModel.countDocuments({ status: 'waiting' }),
  ]);
  const t = dash.totals;
  return JSON.stringify({
    members: t.members,
    idChecksWaiting: t.pendingVerifications,
    booksOnLoan: t.activeLoans,
    overdueLoans: t.overdueLoans,
    unpaidFinesPaise: t.outstandingDues,
    depositRefundRequests: refunds,
    reservationsWaiting: reservations,
  });
}

function pageMap(role: Role) {
  return GUIDE[role]
    .map(
      (p) => `## ${p.title} (${p.path})\n${p.summary}\n${p.steps.map((s) => `- ${s}`).join('\n')}`,
    )
    .join('\n\n');
}

/** Keeps markdown links only when they point at a page this role can open. */
export function safeLinks(role: Role, text: string) {
  return text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label: string, href: string) =>
    href.startsWith('/') && isGuidePath(role, href) ? all : label,
  );
}

export async function askGuide(
  auth: { userId: string; role: Role; libraryId?: string | null },
  body: GuideBody,
) {
  const { role, libraryId } = auth;
  const library = libraryId ? await LibraryModel.findById(libraryId).select('name').lean() : null;
  const here = guideFor(role, body.page);
  const system = `You are the LibraVerse guide, a friendly helper inside the LibraVerse library app. You are talking with ${ROLE_NAMES[role]}${library ? ` of ${library.name}` : ''}.
Help them use the app: explain how to do things step by step, using the page guide below. They are on ${here ? `the "${here.title}" page (${here.path})` : `the page ${body.page}`}.

Rules:
- Only describe pages, buttons and steps that appear in the page guide. If the guide does not cover something, say you are not sure and suggest asking the library staff (or, for staff, the library admin).
- Link to pages with markdown links using the exact paths from the guide, for example [${GUIDE[role][0]!.title}](${GUIDE[role][0]!.path}). Never link anywhere else.
- You can look things up with the tools, but you cannot do anything yourself: no payments, issues, returns, approvals, refunds or settings changes. Tell them where to do it.
- Never guess availability, prices, dates, fines or counts: use a tool, or say where to find it.
- Money is in Indian rupees; tool amounts ending in "Paise" are in paise (divide by 100).
- Keep answers short: a sentence or two, or a short numbered list of steps.
- For anything unrelated to LibraVerse, say briefly that you can only help with the app.
Today is ${new Date().toISOString().slice(0, 10)}.

# Page guide for this role
${pageMap(role)}`;

  const result = await converse({
    system,
    tools: toolsFor(role),
    messages: body.messages,
    runTool: (name, input) => {
      if (name === 'get_library_status' && role !== 'member' && role !== 'superAdmin') {
        return libraryStatus();
      }
      if (!libraryId || role === 'superAdmin') return Promise.resolve(`Unknown tool ${name}`);
      if (name === 'get_my_account' && role !== 'member') {
        return Promise.resolve(`Unknown tool ${name}`);
      }
      return runMemberTool(name, input, auth.userId, libraryId);
    },
    refusal: 'Sorry, I can’t help with that. Ask me how to do something in LibraVerse.',
    noAnswer: 'Sorry, I could not find an answer. Try asking in a different way.',
  });
  return { reply: safeLinks(role, result.reply) };
}
