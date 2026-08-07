import { useState } from 'react';

/** Green above 0.5, amber down to 0.35, red below — mirrors the retrieval
 *  quality bands worth worrying about on this pipeline. */
function scoreColor(similarity) {
  if (similarity >= 0.5) return { bar: 'bg-emerald-400', text: 'text-emerald-300' };
  if (similarity >= 0.35) return { bar: 'bg-amber-400', text: 'text-amber-300' };
  return { bar: 'bg-rose-400', text: 'text-rose-300' };
}

function SourceRow({ source, rank }) {
  const [open, setOpen] = useState(false);
  const color = scoreColor(source.similarity);

  return (
    <li className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900/60">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-ink-850"
      >
        <span className="w-4 shrink-0 text-[11px] tabular-nums text-ink-600">{rank}</span>

        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-100">
          {source.file_path}
        </span>

        <span className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-ink-800 sm:block">
          <span
            className={`block h-full rounded-full ${color.bar}`}
            style={{ width: `${Math.max(4, Math.min(100, source.similarity * 100))}%` }}
          />
        </span>

        <span className={`w-11 shrink-0 text-right font-mono text-[11.5px] tabular-nums ${color.text}`}>
          {source.similarity.toFixed(3)}
        </span>

        <span className={`shrink-0 text-ink-400 transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <pre className="overflow-x-auto border-t border-ink-700 bg-ink-950 px-3.5 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
          {source.preview}
          {source.preview.length >= 150 && <span className="text-ink-600">…</span>}
        </pre>
      )}
    </li>
  );
}

export default function SourceList({ sources }) {
  if (!sources.length) return null;

  const top = Math.max(...sources.map((source) => source.similarity));

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-sm font-semibold text-white">Sources</h3>
        <span className="text-[11px] text-ink-400">
          {sources.length} chunks retrieved · best match {top.toFixed(3)}
        </span>
      </div>

      <ul className="space-y-1.5">
        {sources.map((source, index) => (
          <SourceRow key={`${source.file_path}-${index}`} source={source} rank={index + 1} />
        ))}
      </ul>

      {top < 0.35 && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-200">
          Low similarity across the board — the answer may be weakly grounded. Try naming a
          specific file, symbol, or feature.
        </p>
      )}
    </section>
  );
}
