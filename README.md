# DevDocs AI — Node + React

A codebase-aware RAG assistant. Point it at any public GitHub repository and ask engineering
questions in plain English — _"Where is the payment logic?"_, _"How do I add a new API endpoint
following the existing pattern?"_ — and get an answer grounded in the actual code, with
file-level citations and cosine-similarity scores.

This is a port of the original Python/FastAPI implementation to an **Express backend and a React
frontend**. No RAG framework — chunking, embeddings, vector search, and grounded generation are
all written out directly.

It reads and writes the **same `chunks` table** as the Python version: the embedding model is the
same (`all-MiniLM-L6-v2`, 384-dim), truncated at the same 256 tokens, so vectors produced by
either implementation are interchangeable.

---

## How it works

```
GitHub repo URL
      │
      ▼
┌──────────────────┐   GitHub Tree API, bounded concurrency (10 in flight)
│ githubFetcher.js │   → [{ path, content }]
└────────┬─────────┘
         ▼
┌──────────────────┐   Line-aware splitter, 1500 chars/chunk, 200 char overlap
│ chunker.js       │   → [chunk]
└────────┬─────────┘
         ▼
┌──────────────────┐   Transformers.js — all-MiniLM-L6-v2, fp32, runs locally
│ embedder.js      │   → chunk + 384-dim embedding
└────────┬─────────┘
         ▼
┌──────────────────┐   Postgres + pgvector, batched multi-row INSERT
│ store.js         │   saveChunks() / searchChunks()
└────────┬─────────┘
         ▼
┌──────────────────┐   embed question → cosine top-k → grounded prompt
│ query/pipeline   │   → Groq (llama-3.3-70b-versatile) → answer + citations
└────────┬─────────┘
         ▼
   Express (/index, /query, /query/stream)  ◄──►  React + Vite frontend
```

## Project structure

```
Rg/
├── server/                    # Express backend
│   ├── src/
│   │   ├── ingestion/         # githubFetcher → chunker → embedder → store
│   │   ├── query/pipeline.js  # retrieval + grounded generation (streaming and not)
│   │   ├── routes/            # /index, /query, and their SSE variants
│   │   ├── utils/             # concurrency limiter, SSE helper
│   │   ├── monitoring.js      # request tracing
│   │   ├── config.js          # env + tunables in one place
│   │   ├── db.js              # pg pool, pgvector serialisation
│   │   └── index.js           # app wiring and startup
│   └── scripts/               # check-db, smoke, fix-index
└── client/                    # React + Vite + Tailwind frontend
    └── src/
        ├── components/        # RepoSidebar, AskPanel, AnswerPanel, SourceList
        ├── lib/api.js         # typed client, incl. the SSE reader
        └── App.jsx
```

## Running it

**Prerequisites:** Node 18+, a Postgres database with the `pgvector` extension, a
[Groq API key](https://console.groq.com/keys), and (optionally, to raise the rate limit) a GitHub
personal access token.

### Backend

```bash
cd server
npm install
cp .env.example .env     # then fill in DATABASE_URL and GROQ_API_KEY
npm run dev              # http://localhost:8000
```

The first start downloads the ~90 MB embedding model into `server/.cache/` and creates the
`chunks` table if it doesn't exist. The server accepts connections while the model loads.

```bash
npm run check-db         # is the database reachable? what's indexed?
npm run smoke            # end-to-end check against a running server
npm run check-tracing    # is AgentWatch actually accepting traces?
```

### Tracing (AgentWatch)

The backend depends on the AgentWatch TypeScript SDK from a local checkout:

```json
"agentwatch": "file:../../../StartUp/sdk-ts"
```

npm links this as a junction rather than copying it, so a rebuild in the SDK (`npm run build`
there) is picked up on the next server restart — no reinstall.

Tracing is enabled whenever `AGENTWATCH_API_KEY` and `AGENTWATCH_AGENT_ID` are set, and is a
no-op otherwise. Delivery is fire-and-forget and never blocks a request, which also means a
rejected trace is invisible from the outside — hence `npm run check-tracing`, which sends one
synthetic trace and prints what the collector said.

To trace against a locally running collector instead of the hosted one, set `AGENTWATCH_ENDPOINT`
(the `backend_aw` service defaults to port 3001):

```
AGENTWATCH_ENDPOINT=http://localhost:3001
```

### Frontend

```bash
cd client
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:8000
npm run dev              # http://localhost:5173
```

Paste a GitHub URL, index it, ask a question.

## API

| Method | Path            | Purpose                                                        |
| ------ | --------------- | -------------------------------------------------------------- |
| GET    | `/health`       | Liveness + database reachability                               |
| GET    | `/repos`        | Indexed repos with chunk/file counts                           |
| POST   | `/index`        | `{ repo_url }` → fetch, chunk, embed, store                    |
| POST   | `/index/stream` | Same, streaming progress as SSE                                |
| POST   | `/query`        | `{ question, repo }` → `{ answer, sources }`                   |
| POST   | `/query/stream` | Same, streaming `sources` → `token`… → `done` as SSE           |
| GET    | `/traces`       | Recent traces, each with its AgentWatch delivery status        |

SSE frames are `data: {"type": ..., "content": ...}`. `EventSource` can't issue POST requests, so
the frontend consumes these with `fetch` + a small parser in `client/src/lib/api.js`.

## Configuration

Everything lives in `server/.env` (see `.env.example`). Beyond the credentials:

| Variable         | Default                    | Purpose                                      |
| ---------------- | -------------------------- | -------------------------------------------- |
| `PORT`           | `8000`                     | Backend port                                 |
| `ALLOWED_ORIGINS`| `localhost:5173,:3000`     | Comma-separated CORS allowlist               |
| `GROQ_MODEL`     | `llama-3.3-70b-versatile`  | Generation model                             |
| `TOP_K`          | `8`                        | Chunks retrieved per question                |
| `IVFFLAT_PROBES` | `100`                      | ivfflat lists probed per search — see below  |
| `HNSW_EF_SEARCH` | `100`                      | HNSW candidate list size                     |

## A note on the vector index

Retrieval was returning too few chunks — sometimes zero, on a table that plainly contained
matches. The cause was the ivfflat index:

```sql
CREATE INDEX chunks_embedding_idx ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = '100');
```

ivfflat partitions rows into `lists` clusters and, by default, searches exactly **one** of them
(`ivfflat.probes = 1`). With `lists = 100` over a couple hundred rows, most clusters hold one or
two rows and many are empty — so a `WHERE repo = ...` top-8 query would come back with five rows,
or none, depending on which centroid the question vector happened to land nearest. Silently: no
error, just thin or empty context handed to the LLM.

Two things address it:

1. **The server raises `ivfflat.probes` per connection** (`tuneClient()` in
   `src/ingestion/store.js`). This is on by default and needs nothing from you. Verified against a
   brute-force scan — the top-8 now matches exact search, in the correct order.
2. **`npm run fix-index`** replaces the ivfflat index with HNSW, which needs no size-dependent
   tuning and holds recall under a `WHERE` filter. It's a dry run unless you pass `--apply`, and it
   prints the statement to restore the old index first.

The index is shared with any other app pointed at the same database, which is why step 2 is
opt-in rather than automatic.

If you're comparing similarity scores against the original: they were being computed over a
degraded candidate set, so low scores there weren't necessarily a chunking or embedding problem.

## Differences from the Python version

- **Embeddings** run through Transformers.js instead of sentence-transformers. Same model, same
  dimensions; `quantized: false` keeps fp32 weights and the tokenizer is pinned to 256 tokens, both
  so vectors line up with existing rows.
- **Inserts are batched** (100 rows per statement, one transaction) rather than one statement per
  chunk, which dominated indexing time against a pooled remote database.
- **Indexing streams progress** over `/index/stream`, so a large repo shows real feedback instead
  of a spinner.
- **`/repos`** lists what's already indexed, so the UI can offer a picker.
- **Tracing goes through the AgentWatch TypeScript SDK** (`agentwatch`, linked from
  `E:\StartUp\sdk-ts`), the counterpart to the Python SDK the original used. `monitoring.js` keeps
  the same `record()` shape and additionally mirrors every trace into an in-process ring buffer at
  `/traces`, annotated with whether the collector accepted it.

## Known limitations

- Retrieval is pure vector similarity. Hybrid search (BM25 + vector) would help on questions that
  hinge on an exact identifier.
- Chunking is line/character-based, not syntax-aware.
- Single-tenant: re-indexing a repo replaces its chunks wholesale, and there's no per-user
  isolation.
- `scripts/smoke.js` is an end-to-end check, not a unit test suite, and isn't wired into CI.
