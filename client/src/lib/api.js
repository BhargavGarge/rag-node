const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

async function toError(response) {
  const body = await response.json().catch(() => null);
  return new Error(body?.detail || `Request failed (${response.status})`);
}

/**
 * Reads an SSE body frame by frame. EventSource can't do POST, so the backend's
 * streams are consumed with fetch + a manual parser — a frame is everything up
 * to a blank line, and we keep the trailing partial in `buffer`.
 */
async function readSse(response, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  signal?.addEventListener('abort', () => reader.cancel().catch(() => {}));

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // A frame that isn't valid JSON is a bug on the server, not something
        // the user can act on — drop it rather than killing the stream.
      }
    }
  }
}

async function postStream(path, body, onEvent, signal) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) throw await toError(response);
  await readSse(response, onEvent, signal);
}

export async function listRepos() {
  const response = await fetch(`${API_URL}/repos`);
  if (!response.ok) throw await toError(response);
  const data = await response.json();
  return data.repos;
}

/** Streams `{type:'progress'|'done'|'error', ...}` while a repo is ingested. */
export function indexRepoStream(repoUrl, onEvent, signal) {
  return postStream('/index/stream', { repo_url: repoUrl }, onEvent, signal);
}

/** Streams `{type:'sources'|'token'|'done'|'error', content}` for an answer. */
export function queryStream({ question, repo }, onEvent, signal) {
  return postStream('/query/stream', { question, repo }, onEvent, signal);
}

/** Non-streaming fallback — same answer, delivered in one piece. */
export async function query({ question, repo }) {
  const response = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, repo }),
  });
  if (!response.ok) throw await toError(response);
  return response.json();
}

export { API_URL };
