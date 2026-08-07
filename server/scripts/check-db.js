/**
 * Sanity check: is the database reachable, does pgvector exist, what's in it?
 *   npm run check-db
 */
import { pool } from '../src/db.js';
import { listRepos } from '../src/ingestion/store.js';

const rows = (result) => result.rows;

try {
  const [{ version }] = rows(await pool.query('SELECT version()'));
  console.log(`Connected: ${version.split(',')[0]}`);

  const ext = rows(await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`));
  console.log(ext.length ? `pgvector: ${ext[0].extversion}` : 'pgvector: NOT INSTALLED');

  const cols = rows(
    await pool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'chunks'
        ORDER BY ordinal_position`,
    ),
  );

  if (cols.length === 0) {
    console.log("Table 'chunks': missing — start the server once to create it.");
  } else {
    console.log("\nTable 'chunks':");
    for (const col of cols) console.log(`  ${col.column_name.padEnd(12)} ${col.data_type}`);
  }

  const repos = await listRepos();
  console.log(`\nIndexed repos: ${repos.length}`);
  for (const repo of repos) {
    console.log(`  ${repo.repo.padEnd(40)} ${repo.chunks} chunks / ${repo.files} files`);
  }
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
