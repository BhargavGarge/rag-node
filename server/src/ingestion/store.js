import { pool, toVector } from '../db.js';
import { config } from '../config.js';

const INSERT_BATCH = 100;

/**
 * Approximate-index search settings, applied once per physical connection.
 *
 * These matter more than they look. An ivfflat index probes `ivfflat.probes`
 * lists (default: 1) and returns only what it finds there — so with a `WHERE
 * repo = ...` filter on top, a query can come back with fewer rows than the
 * LIMIT, or none at all, while the table plainly contains matches. Raising
 * probes trades a little speed for recall you can actually rely on.
 *
 * `hnsw.*` is set for the same reason and is simply ignored when the index is
 * ivfflat. Both are wrapped because the GUCs only exist on newer pgvector.
 */
const tunedClients = new WeakSet();

async function tuneClient(client) {
  if (tunedClients.has(client)) return;

  for (const statement of [
    `SET ivfflat.probes = ${config.ivfflatProbes}`,
    `SET hnsw.ef_search = ${config.hnswEfSearch}`,
    'SET hnsw.iterative_scan = strict_order',
  ]) {
    // Each SET is its own implicit transaction, so an unsupported one on an
    // older pgvector can't poison the queries that follow.
    try {
      await client.query(statement);
    } catch {
      /* GUC not available on this pgvector version — fine, skip it. */
    }
  }

  tunedClients.add(client);
}

/**
 * Creates the table + index if they don't exist yet, so pointing the server at
 * an empty database Just Works. Matches the schema the Python version used:
 * id / repo / file_path / content / embedding vector(384) / created_at.
 */
export async function ensureSchema() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id         BIGSERIAL PRIMARY KEY,
      repo       TEXT NOT NULL,
      file_path  TEXT NOT NULL,
      content    TEXT NOT NULL,
      embedding  vector(${config.embeddingDims}),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS chunks_repo_idx ON chunks (repo)');

  // Only build a vector index when the table has none. If one already exists —
  // including an ivfflat index from the original Python app — leave it alone;
  // tuneClient() compensates for it at query time. `npm run fix-index`
  // replaces a badly-tuned one, but that's an explicit, opt-in decision.
  const { rows } = await pool.query(`
    SELECT 1 FROM pg_index i
      JOIN pg_class c  ON c.oid = i.indexrelid
      JOIN pg_class t  ON t.oid = i.indrelid
      JOIN pg_am    am ON am.oid = c.relam
     WHERE t.relname = 'chunks' AND am.amname IN ('hnsw', 'ivfflat')
     LIMIT 1
  `);

  if (rows.length === 0) {
    try {
      await pool.query(
        'CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops)',
      );
      console.log('Created HNSW index on chunks.embedding.');
    } catch (err) {
      // pgvector < 0.5 has no HNSW. Exact search still works, just slower.
      console.warn(`Skipped vector index creation: ${err.message}`);
    }
  }
}

export async function clearRepo(repo) {
  const result = await pool.query('DELETE FROM chunks WHERE repo = $1', [repo]);
  return result.rowCount;
}

/**
 * Multi-row INSERT in batches. The Python version issued one statement per
 * chunk; on a pooled remote database that round-trip dominated indexing time.
 */
export async function saveChunks(repo, chunks, onProgress = () => {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const batch = chunks.slice(i, i + INSERT_BATCH);

      const values = [];
      const placeholders = batch.map((chunk, row) => {
        const base = row * 4;
        values.push(repo, chunk.path, chunk.content, toVector(chunk.embedding));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector)`;
      });

      await client.query(
        `INSERT INTO chunks (repo, file_path, content, embedding) VALUES ${placeholders.join(', ')}`,
        values,
      );

      onProgress({ done: Math.min(i + INSERT_BATCH, chunks.length), total: chunks.length });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return chunks.length;
}

/**
 * Cosine nearest-neighbour search. `<=>` is pgvector's cosine *distance*, so
 * similarity is 1 - distance.
 */
export async function searchChunks(queryEmbedding, repo, topK = config.topK) {
  const vector = toVector(queryEmbedding);
  const client = await pool.connect();

  try {
    await tuneClient(client);

    const { rows } = await client.query(
      `SELECT file_path,
              content,
              1 - (embedding <=> $1::vector) AS similarity
         FROM chunks
        WHERE repo = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [vector, repo, topK],
    );

    return rows.map((row) => ({
      file_path: row.file_path,
      content: row.content,
      similarity: Number(row.similarity),
    }));
  } finally {
    client.release();
  }
}

/** Powers the "already indexed" picker in the UI. */
export async function listRepos() {
  const { rows } = await pool.query(
    `SELECT repo,
            COUNT(*)::int              AS chunks,
            COUNT(DISTINCT file_path)::int AS files,
            MAX(created_at)            AS indexed_at
       FROM chunks
      GROUP BY repo
      ORDER BY MAX(created_at) DESC NULLS LAST`,
  );
  return rows;
}
