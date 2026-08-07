import pg from 'pg';
import { config } from './config.js';

// Supabase's pooler terminates TLS with a cert chain node doesn't ship a root
// for, so verification is off here the same way `sslmode=require` behaves.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (err) => {
  console.error('Postgres pool error:', err.message);
});

/**
 * pgvector's wire format is a plain string literal — `[0.1,0.2,...]` — which we
 * pass as a normal parameter and cast with `::vector` in the SQL.
 */
export function toVector(embedding) {
  return `[${embedding.join(',')}]`;
}

export async function query(text, params) {
  return pool.query(text, params);
}
