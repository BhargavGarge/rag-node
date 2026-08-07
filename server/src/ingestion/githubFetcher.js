import { config } from '../config.js';
import { mapWithConcurrency } from '../utils/concurrency.js';

const CODE_EXTENSIONS = ['.py', '.ts', '.js', '.tsx', '.jsx', '.md', '.txt', '.yaml', '.toml'];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '__pycache__',
  '.git', '.next', 'venv', '.venv',
]);

// The blob API refuses anything over 1 MB, so filtering on the size the tree
// already reports saves a request that could only ever fail.
const MAX_BLOB_BYTES = 1_000_000;

function headers() {
  const base = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'devdocs-ai',
  };
  return config.githubToken
    ? { ...base, Authorization: `Bearer ${config.githubToken}` }
    : base;
}

function shouldSkip(path) {
  return path.split('/').some((part) => SKIP_DIRS.has(part));
}

function hasValidExtension(path) {
  return CODE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** "https://github.com/pallets/flask/" -> { owner, repo, slug } */
export function parseRepoUrl(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(www\.)?github\.com\//, '');

  const [owner, repo] = cleaned.split('/');
  if (!owner || !repo) {
    throw Object.assign(new Error('Invalid GitHub URL or repo slug'), { status: 400 });
  }
  return { owner, repo, slug: `${owner}/${repo}` };
}

async function githubJson(url) {
  const res = await fetch(url, { headers: headers() });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) {
      throw Object.assign(new Error('Repository not found (or it is private)'), { status: 404 });
    }
    if (res.status === 403 && body.includes('rate limit')) {
      throw Object.assign(
        new Error('GitHub rate limit hit — set GITHUB_TOKEN in server/.env'),
        { status: 429 },
      );
    }
    throw Object.assign(new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`), {
      status: res.status,
    });
  }

  return res.json();
}

async function getFileTree(owner, repo) {
  const data = await githubJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
  );

  if (data.truncated) {
    console.warn('GitHub truncated the file tree — indexing the portion it returned.');
  }

  return (data.tree || []).filter(
    (item) =>
      item.type === 'blob' &&
      hasValidExtension(item.path) &&
      !shouldSkip(item.path) &&
      (item.size ?? 0) <= MAX_BLOB_BYTES,
  );
}

async function fetchFileContent(item) {
  try {
    const data = await githubJson(item.url);
    const content = Buffer.from(data.content || '', 'base64').toString('utf8');
    return { path: item.path, content };
  } catch (err) {
    console.warn(`Failed: ${item.path} — ${err.message}`);
    return null;
  }
}

/**
 * Fetches every indexable text file in a public repo.
 * @param {(update: {stage: string, done?: number, total?: number}) => void} [onProgress]
 * @returns {Promise<Array<{path: string, content: string}>>}
 */
export async function fetchRepo(repoUrl, onProgress = () => {}) {
  const { owner, repo, slug } = parseRepoUrl(repoUrl);

  onProgress({ stage: 'tree' });
  const items = await getFileTree(owner, repo);

  if (items.length === 0) {
    throw Object.assign(
      new Error(`No indexable files found in ${slug} (looked for ${CODE_EXTENSIONS.join(', ')})`),
      { status: 422 },
    );
  }

  let done = 0;
  const results = await mapWithConcurrency(items, config.fetchConcurrency, async (item) => {
    const file = await fetchFileContent(item);
    done += 1;
    if (done % 25 === 0 || done === items.length) {
      onProgress({ stage: 'fetch', done, total: items.length });
    }
    return file;
  });

  return results.filter(Boolean);
}
