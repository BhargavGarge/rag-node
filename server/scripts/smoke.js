/**
 * End-to-end check against a running server.
 *   npm run smoke -- [repo] [question]
 */
const BASE = process.env.SMOKE_URL || 'http://localhost:8000';
const repoArg = process.argv[2];
const question = process.argv[3] || 'What does this project do and how is it structured?';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// --- health + repo list ---------------------------------------------------
const health = await fetch(`${BASE}/health`).then((r) => r.json());
check('GET /health', health.ok === true, `database ${health.database}`);

const { repos } = await fetch(`${BASE}/repos`).then((r) => r.json());
check('GET /repos', Array.isArray(repos), `${repos?.length ?? 0} indexed`);

const repo = repoArg || repos?.[0]?.repo;
if (!repo) {
  console.log('\nNo indexed repo to query. Index one first, or pass a repo slug.');
  process.exit(failures ? 1 : 0);
}
console.log(`\nUsing repo: ${repo}\nQuestion:   ${question}\n`);

// --- non-streaming query --------------------------------------------------
const result = await post('/query', { question, repo }).then((r) => r.json());
const sources = result.sources || [];
const sims = sources.map((s) => s.similarity);

check('POST /query returns sources', sources.length > 0, `${sources.length} chunks`);
check(
  'sources are ranked by descending similarity',
  sims.every((v, i) => i === 0 || sims[i - 1] >= v),
  sims.map((s) => s.toFixed(3)).join(' '),
);
check('answer is non-empty', (result.answer || '').length > 50, `${result.answer?.length} chars`);
check(
  'answer cites at least one retrieved file',
  sources.some((s) => result.answer?.includes(s.file_path.split('/').pop())),
);

// --- streaming query ------------------------------------------------------
const response = await post('/query/stream', { question, repo });
const reader = response.body.getReader();
const decoder = new TextDecoder();

let buffer = '';
const events = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split('\n\n');
  buffer = frames.pop();
  for (const frame of frames) {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (line) events.push(JSON.parse(line.slice(6)));
  }
}

const types = events.map((e) => e.type);
const tokens = events.filter((e) => e.type === 'token');

check('POST /query/stream emits sources first', types[0] === 'sources', `${events.length} frames`);
check('stream emits tokens', tokens.length > 5, `${tokens.length} token frames`);
check('stream terminates with done', types.at(-1) === 'done');
check('no error frames', !types.includes('error'));

const streamed = tokens.map((e) => e.content).join('');
console.log(`\n--- streamed answer (first 300 chars) ---\n${streamed.slice(0, 300)}\n`);

console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
