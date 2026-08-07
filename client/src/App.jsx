import { useCallback, useEffect, useRef, useState } from 'react';
import RepoSidebar from './components/RepoSidebar.jsx';
import AskPanel from './components/AskPanel.jsx';
import AnswerPanel from './components/AnswerPanel.jsx';
import { API_URL, indexRepoStream, listRepos, queryStream } from './lib/api.js';

export default function App() {
  const [repos, setRepos] = useState([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [backendUp, setBackendUp] = useState(null);

  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [retrieving, setRetrieving] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef(null);

  const refreshRepos = useCallback(async () => {
    try {
      const list = await listRepos();
      setBackendUp(true);
      setRepos(list);
      // Auto-select the most recently indexed repo so the app is usable on load.
      setSelectedRepo((current) => current || list[0]?.repo || '');
      return list;
    } catch {
      setBackendUp(false);
      return [];
    }
  }, []);

  useEffect(() => {
    refreshRepos();
  }, [refreshRepos]);

  const handleIndex = async (repoUrl) => {
    setIndexing(true);
    setIndexProgress({ message: 'Starting…' });
    setError('');

    try {
      await indexRepoStream(repoUrl, (event) => {
        if (event.type === 'progress') {
          setIndexProgress({ message: event.message, done: event.done, total: event.total });
        } else if (event.type === 'done') {
          setSelectedRepo(event.content.repo);
          refreshRepos();
        } else if (event.type === 'error') {
          setError(event.content);
        }
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  };

  const handleAsk = async (text) => {
    if (!selectedRepo) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setQuestion(text);
    setAnswer('');
    setSources([]);
    setError('');
    setRetrieving(true);
    setStreaming(true);

    try {
      await queryStream(
        { question: text, repo: selectedRepo },
        (event) => {
          if (event.type === 'sources') {
            setRetrieving(false);
            setSources(event.content);
          } else if (event.type === 'token') {
            // Functional update: tokens arrive faster than React re-renders, so
            // reading `answer` from the closure would drop characters.
            setAnswer((current) => current + event.content);
          } else if (event.type === 'error') {
            setRetrieving(false);
            setError(event.content);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      setRetrieving(false);
      setStreaming(false);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setRetrieving(false);
  };

  return (
    <div className="aurora min-h-screen">
      <div className="relative z-10 mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              DevDocs&nbsp;AI
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-400">
              Point it at a public GitHub repo and ask engineering questions in plain English.
              Answers are grounded in the actual code, with file-level citations.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/70 px-3 py-1.5 text-[11.5px] backdrop-blur">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                backendUp === null
                  ? 'bg-ink-600'
                  : backendUp
                    ? 'bg-emerald-400'
                    : 'bg-rose-400'
              }`}
            />
            <span className="text-ink-400">
              {backendUp === null ? 'connecting' : backendUp ? 'backend online' : 'backend offline'}
            </span>
          </div>
        </header>

        {backendUp === false && (
          <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 text-sm">
            <p className="font-semibold text-rose-200">Can&apos;t reach the backend</p>
            <p className="mt-1 text-xs leading-relaxed text-rose-300/90">
              Expected it at <span className="font-mono">{API_URL}</span>. Start it with{' '}
              <span className="font-mono">npm start</span> in{' '}
              <span className="font-mono">server/</span>, or change{' '}
              <span className="font-mono">VITE_API_URL</span> in{' '}
              <span className="font-mono">client/.env</span>.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <RepoSidebar
            repos={repos}
            selectedRepo={selectedRepo}
            onSelect={setSelectedRepo}
            onIndex={handleIndex}
            indexing={indexing}
            progress={indexProgress}
          />

          <main className="min-w-0 flex-1 space-y-6">
            <AskPanel
              repo={selectedRepo}
              onAsk={handleAsk}
              onStop={handleStop}
              busy={retrieving || streaming}
            />
            <AnswerPanel
              question={question}
              answer={answer}
              sources={sources}
              streaming={streaming}
              retrieving={retrieving}
              error={error}
            />
          </main>
        </div>

        <footer className="mt-12 border-t border-ink-800 pt-6 text-[11.5px] leading-relaxed text-ink-600">
          Node + Express · pgvector cosine search · all-MiniLM-L6-v2 embeddings (384d, local) ·
          Groq llama-3.3-70b-versatile
        </footer>
      </div>
    </div>
  );
}
