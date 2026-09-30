import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, ErrorText, PageHeader } from '../../components/ui';
import { api, errorMessage, post } from '../../lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  'Is "Wings of Fire" available?',
  'What is the late fine?',
  'When are my books due?',
  'Suggest a history book',
];

/** FR-25: ask about books, rules and fines. */
export function AssistantPage() {
  const status = useQuery({
    queryKey: ['member', 'assistant'],
    queryFn: () => api<{ enabled: boolean }>('/api/member/assistant/status'),
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const ask = useMutation({
    mutationFn: (history: Msg[]) =>
      post<{ reply: string }>('/api/member/assistant', { messages: history.slice(-20) }),
    onSuccess: (r) => setMessages((m) => [...m, { role: 'assistant', content: r.reply }]),
  });

  function send(text: string) {
    const t = text.trim();
    if (!t || ask.isPending) return;
    const next = [...messages, { role: 'user' as const, content: t }];
    setMessages(next);
    setDraft('');
    ask.mutate(next);
  }

  if (status.data && !status.data.enabled) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Library assistant" />
        <p className="text-gray-400">The assistant is not switched on for this library yet.</p>
      </div>
    );
  }
  return (
    <div className="flex max-w-2xl flex-col">
      <PageHeader title="Library assistant" />
      <div
        className="min-h-[300px] space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-gray-400">
              Ask about books, borrowing rules, fines or your loans.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:border-brand-500"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <p
              className={`inline-block max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-left text-sm ${m.role === 'user' ? 'bg-brand-500 text-white' : 'bg-gray-800 text-gray-100'}`}
            >
              {m.content}
            </p>
          </div>
        ))}
        {ask.isPending && <p className="text-sm text-gray-500">Thinking…</p>}
        <ErrorText>{ask.error ? errorMessage(ask.error) : ''}</ErrorText>
      </div>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          send(draft);
        }}
        className="mt-3 flex gap-2"
      >
        <label className="flex-1">
          <span className="sr-only">Your question</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={2000}
            placeholder="Type a question"
            className="block w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2"
          />
        </label>
        <Button type="submit" disabled={!draft.trim()} busy={ask.isPending}>
          Ask
        </Button>
      </form>
    </div>
  );
}
