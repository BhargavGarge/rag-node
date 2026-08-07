import { useState } from 'react';

function timeAgo(iso) {
  if (!iso) return '';
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  const steps = [
    [60, 'just now', 1],
    [3600, 'm ago', 60],
    [86400, 'h ago', 3600],
    [2592000, 'd ago', 86400],
  ];
  for (const [limit, label, divisor] of steps) {
    if (seconds < limit) return divisor === 1 ? label : `${Math.floor(seconds / divisor)}${label}`;
  }
  return new Date(iso).toLocaleDateString();
}

export default function RepoSidebar({
  repos,
  selectedRepo,
  onSelect,
  onIndex,
  indexing,
  progress,
}) {
  const [url, setUrl] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const value = url.trim();
    if (value && !indexing) onIndex(value);
  };

  return (
    <aside className="flex w-full shrink-0 flex-col gap-6 lg:w-[340px]">
      <section className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5 backdrop-blur">
        <h2 className="text-sm font-semibold text-white">Index a repository</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-400">
          Any public GitHub repo. Fetched, chunked, embedded, and stored as vectors.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/pallets/flask"
            disabled={indexing}
            spellCheck={false}
            className="w-full rounded-xl border border-ink-700 bg-ink-950 px-3 py-2.5 font-mono text-[13px] text-ink-100 outline-none transition placeholder:text-ink-600 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/25 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={indexing || !url.trim()}
            className="w-full rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-500 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400"
          >
            {indexing ? 'Indexing…' : 'Index repository'}
          </button>
        </form>

        {indexing && progress && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-ink-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-400" />
              <span className="truncate">{progress.message}</span>
            </div>
            {progress.total > 0 && (
              <div className="h-1 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full rounded-full bg-accent-500 transition-all duration-300"
                  style={{ width: `${Math.round(((progress.done || 0) / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-white">Indexed</h2>
          <span className="text-xs text-ink-400">{repos.length}</span>
        </div>

        {repos.length === 0 ? (
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            Nothing indexed yet. Paste a repo URL above to get started.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {repos.map((repo) => {
              const active = repo.repo === selectedRepo;
              return (
                <li key={repo.repo}>
                  <button
                    onClick={() => onSelect(repo.repo)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      active
                        ? 'border-accent-500/60 bg-accent-500/10'
                        : 'border-transparent hover:border-ink-700 hover:bg-ink-850'
                    }`}
                  >
                    <div
                      className={`truncate font-mono text-[13px] ${active ? 'text-white' : 'text-ink-100'}`}
                    >
                      {repo.repo}
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-ink-400">
                      <span>{repo.chunks} chunks</span>
                      <span>·</span>
                      <span>{repo.files} files</span>
                      {repo.indexed_at && (
                        <>
                          <span>·</span>
                          <span>{timeAgo(repo.indexed_at)}</span>
                        </>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </aside>
  );
}
