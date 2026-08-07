/**
 * Replaces a badly-tuned ivfflat index on chunks.embedding with an HNSW index.
 *
 *   npm run fix-index -- --apply
 *
 * Why you'd want to: ivfflat splits the table into `lists` clusters and, by
 * default, searches exactly one of them. The index this project shipped with
 * used lists=100 — sized for hundreds of thousands of rows — on a table holding
 * a couple hundred. Most of those clusters are empty, so a filtered top-k query
 * routinely returned a handful of rows, or zero, instead of the 8 it asked for.
 *
 * The running server already compensates by raising ivfflat.probes, so this is
 * optional. It's worth doing anyway: HNSW needs no size-dependent tuning, keeps
 * high recall under a WHERE filter, and stays fast as the table grows.
 *
 * This rewrites a shared index — anything else pointed at the same database
 * (the original Python backend, for instance) is affected too. It only ever
 * improves recall, and the exact statement to restore the old index is printed
 * before anything changes.
 */
import { pool } from '../src/db.js';

const apply = process.argv.includes('--apply');

const { rows: indexes } = await pool.query(`
  SELECT c.relname AS name, am.amname AS method, pg_get_indexdef(i.indexrelid) AS def
    FROM pg_index i
    JOIN pg_class c  ON c.oid = i.indexrelid
    JOIN pg_class t  ON t.oid = i.indrelid
    JOIN pg_am    am ON am.oid = c.relam
   WHERE t.relname = 'chunks' AND am.amname IN ('hnsw', 'ivfflat')
`);

const [{ n: rowCount }] = (await pool.query('SELECT COUNT(*)::int AS n FROM chunks')).rows;
console.log(`chunks table: ${rowCount} rows`);

if (indexes.length === 0) {
  console.log('No vector index found — start the server once and it will create an HNSW index.');
} else {
  console.log('\nCurrent vector indexes:');
  indexes.forEach((i) => console.log(`  [${i.method}] ${i.def}`));
}

const ivfflat = indexes.filter((i) => i.method === 'ivfflat');
const hasHnsw = indexes.some((i) => i.method === 'hnsw');

if (ivfflat.length === 0) {
  console.log('\nNothing to fix.');
  await pool.end();
  process.exit(0);
}

console.log('\nPlanned changes:');
if (!hasHnsw) {
  console.log('  CREATE INDEX chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);');
}
ivfflat.forEach((i) => console.log(`  DROP INDEX ${i.name};`));

console.log('\nTo restore the old index afterwards:');
ivfflat.forEach((i) => console.log(`  ${i.def};`));

if (!apply) {
  console.log('\nDry run. Re-run with --apply to make these changes.');
  await pool.end();
  process.exit(0);
}

// Build the replacement before dropping the old one, so the table is never
// left without a vector index.
if (!hasHnsw) {
  console.log('\nBuilding HNSW index (this can take a while on a large table)...');
  await pool.query(
    'CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops)',
  );
  console.log('  done.');
}

for (const index of ivfflat) {
  await pool.query(`DROP INDEX IF EXISTS "${index.name}"`);
  console.log(`  dropped ${index.name}`);
}

console.log('\nDone.');
await pool.end();
