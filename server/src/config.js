import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing required env var: ${name} — see server/.env.example\n`);
    process.exit(1);
  }
  return value;
}

function list(value, fallback) {
  return (value || fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT || 8000),

  databaseUrl: required('DATABASE_URL'),
  groqApiKey: required('GROQ_API_KEY'),

  // Unauthenticated GitHub requests work, they're just rate-limited to 60/hr.
  githubToken: process.env.GITHUB_TOKEN || '',

  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  // Xenova's ONNX export of sentence-transformers/all-MiniLM-L6-v2 — same
  // weights, same 384 dims, so vectors written by the Python version and by
  // this one live in the same table interchangeably.
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  embeddingDims: 384,
  // sentence-transformers caps all-MiniLM-L6-v2 at 256 tokens (its
  // sentence_bert_config.json), while the raw HF tokenizer config says 512.
  // Pinning 256 here keeps our vectors identical to the Python pipeline's.
  embeddingMaxTokens: 256,
  embeddingBatchSize: 32,

  chunkSize: 1500,
  chunkOverlap: 200,
  fetchConcurrency: 10,
  topK: Number(process.env.TOP_K || 8),

  // Recall knobs for the approximate vector index — see tuneClient() in
  // ingestion/store.js for why the defaults are this generous.
  ivfflatProbes: Number(process.env.IVFFLAT_PROBES || 100),
  hnswEfSearch: Number(process.env.HNSW_EF_SEARCH || 100),

  allowedOrigins: list(process.env.ALLOWED_ORIGINS, 'http://localhost:5173,http://localhost:3000'),

  agentWatch: {
    apiKey: process.env.AGENTWATCH_API_KEY || '',
    agentId: process.env.AGENTWATCH_AGENT_ID || '',
    // Unset means the SDK's default (https://api.agentwatch.dev). Point this at
    // http://localhost:3001 to trace against a locally running collector.
    endpoint: process.env.AGENTWATCH_ENDPOINT || '',
  },
};
