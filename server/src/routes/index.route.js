import { Router } from 'express';
import { fetchRepo, parseRepoUrl } from '../ingestion/githubFetcher.js';
import { chunkFiles } from '../ingestion/chunker.js';
import { embedChunks } from '../ingestion/embedder.js';
import { clearRepo, saveChunks, listRepos } from '../ingestion/store.js';
import { openSse } from '../utils/sse.js';

export const indexRouter = Router();

/**
 * fetch -> chunk -> embed -> clear -> save.
 * `onStage` gets called between phases so the streaming variant can report
 * progress; the plain JSON route passes a no-op.
 */
async function runIngestion(repoUrl, onStage = () => {}) {
  const { slug } = parseRepoUrl(repoUrl);

  const files = await fetchRepo(repoUrl, (update) => {
    onStage({
      stage: update.stage,
      message:
        update.stage === 'tree'
          ? `Listing files in ${slug}...`
          : `Fetched ${update.done}/${update.total} files`,
      done: update.done,
      total: update.total,
    });
  });

  onStage({ stage: 'chunk', message: `Chunking ${files.length} files...` });
  const chunks = chunkFiles(files);

  onStage({ stage: 'embed', message: `Embedding ${chunks.length} chunks...`, total: chunks.length });
  await embedChunks(chunks, ({ done, total }) => {
    onStage({ stage: 'embed', message: `Embedded ${done}/${total} chunks`, done, total });
  });

  onStage({ stage: 'store', message: 'Writing to the vector store...' });
  // Re-indexing replaces a repo wholesale — there is no per-user isolation.
  await clearRepo(slug);
  await saveChunks(slug, chunks, ({ done, total }) => {
    onStage({ stage: 'store', message: `Saved ${done}/${total} chunks`, done, total });
  });

  return {
    repo: slug,
    files_found: files.length,
    chunks_stored: chunks.length,
    message: `Successfully indexed ${slug}`,
  };
}

indexRouter.get('/repos', async (_req, res, next) => {
  try {
    res.json({ repos: await listRepos() });
  } catch (err) {
    next(err);
  }
});

indexRouter.post('/index', async (req, res, next) => {
  try {
    res.json(await runIngestion(req.body?.repo_url));
  } catch (err) {
    next(err);
  }
});

/** Same pipeline, but streams progress — indexing a large repo takes minutes. */
indexRouter.post('/index/stream', async (req, res) => {
  const send = openSse(res);

  try {
    const result = await runIngestion(req.body?.repo_url, (update) =>
      send({ type: 'progress', ...update }),
    );
    send({ type: 'done', content: result });
  } catch (err) {
    console.error('Index failed:', err);
    send({ type: 'error', content: err.message });
  } finally {
    res.end();
  }
});
