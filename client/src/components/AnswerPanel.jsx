import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SourceList from './SourceList.jsx';

function Placeholder() {
  return (
    <div className="rounded-2xl border border-dashed border-ink-700 px-6 py-14 text-center">
      <div className="text-3xl">📘</div>
      <h3 className="mt-3 text-sm font-semibold text-white">Grounded answers, with receipts</h3>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-400">
        Every answer is generated only from code retrieved out of the vector store, and every
        source chunk is listed below it with its cosine similarity.
      </p>
    </div>
  );
}

export default function AnswerPanel({ question, answer, sources, streaming, error, retrieving }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4">
        <h3 className="text-sm font-semibold text-rose-200">Something went wrong</h3>
        <p className="mt-1.5 font-mono text-xs leading-relaxed break-words text-rose-300/90">
          {error}
        </p>
      </div>
    );
  }

  if (!question) return <Placeholder />;

  return (
    <article className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5 backdrop-blur sm:p-6">
      <h2 className="text-[15px] leading-snug font-semibold text-white">{question}</h2>
      <div className="my-4 h-px bg-ink-800" />

      {retrieving && (
        <div className="flex items-center gap-2.5 text-xs text-ink-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
          Embedding the question and searching the vector store…
        </div>
      )}

      {answer && (
        <div className={`answer-prose text-[14px] text-ink-100 ${streaming ? 'caret' : ''}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
        </div>
      )}

      {!answer && !retrieving && streaming && (
        <div className="flex items-center gap-2.5 text-xs text-ink-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
          Generating…
        </div>
      )}

      <SourceList sources={sources} />
    </article>
  );
}
