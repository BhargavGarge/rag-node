import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { pool } from './db.js';
import { ensureSchema } from './ingestion/store.js';
import { warmUp } from './ingestion/embedder.js';
import { indexRouter } from './routes/index.route.js';
import { queryRouter } from './routes/query.route.js';

const app = express();

app.use(
  cors({
    origin: config.allowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);
// Chunk payloads are small, but repo READMEs pushed through /index aren't.
app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.json({ status: 'DevDocs AI is running', model: config.groqModel });
});

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'up' });
  } catch (err) {
    res.status(503).json({ ok: false, database: 'down', detail: err.message });
  }
});

app.use(indexRouter);
app.use(queryRouter);

app.use((_req, res) => {
  res.status(404).json({ detail: 'Not found' });
});

// Mirrors FastAPI's `{ "detail": ... }` error shape so the frontend has one
// thing to read regardless of which layer failed.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ detail: err.message || 'Internal server error' });
});

async function start() {
  try {
    await ensureSchema();
    console.log('Database ready.');
  } catch (err) {
    console.error(`\nCould not reach the database: ${err.message}`);
    console.error('Check DATABASE_URL in server/.env — the server needs it to do anything.\n');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`DevDocs AI backend on http://localhost:${config.port}`);
    console.log(`CORS allows: ${config.allowedOrigins.join(', ')}`);
  });

  // Non-blocking: the server accepts connections while the model loads.
  warmUp().catch((err) => console.error('Embedding model failed to load:', err.message));
}

start();
