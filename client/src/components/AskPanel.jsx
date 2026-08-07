import { useState } from 'react';

const SUGGESTIONS = [
  'What does this project do, and how is it structured?',
  'Where is the main entry point?',
  'How is state managed in this codebase?',
  'How do I add a new API endpoint following the existing pattern?',
];

export default function AskPanel({ repo, onAsk, onStop, busy }) {
  const [question, setQuestion] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const value = question.trim();
    if (value && repo && !busy) onAsk(value);
  };

  // Enter sends, Shift+Enter breaks the line — the convention for this shape of
  // input, and questions here are often two or three lines long.
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event);
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5 backdrop-blur">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="text-ink-400">Asking</span>
        {repo ? (
          <span className="rounded-md border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[12px] text-accent-400">
            {repo}
          </span>
        ) : (
          <span className="text-ink-600">— select or index a repo first</span>
        )}
      </div>

      <textarea
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={onKeyDown}
        rows={3}
        disabled={!repo}
        placeholder="Ask anything about this codebase…"
        className="w-full resize-y rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3 text-[14px] leading-relaxed text-ink-100 outline-none transition placeholder:text-ink-600 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 disabled:opacity-50"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="hidden text-[11px] text-ink-600 sm:block">
          Enter to send · Shift+Enter for a new line
        </span>

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded-xl border border-ink-600 px-5 py-2.5 text-sm font-semibold text-ink-300 transition hover:border-ink-400 hover:text-white"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!repo || !question.trim()}
            className="rounded-xl bg-accent-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
          >
            Ask
          </button>
        )}
      </div>

      {repo && !busy && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-800 pt-4">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onAsk(suggestion)}
              className="rounded-full border border-ink-700 px-3 py-1.5 text-[11.5px] text-ink-300 transition hover:border-accent-500/50 hover:bg-accent-500/10 hover:text-white"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
