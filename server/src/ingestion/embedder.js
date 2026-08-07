import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@xenova/transformers';
import { config } from '../config.js';

// Cache the ONNX weights next to the server instead of in a global npm dir, so
// a fresh clone re-downloads once and never surprises you mid-request.
// fileURLToPath, not URL.pathname — the latter yields "/E:/..." on Windows.
env.cacheDir = fileURLToPath(new URL('../../.cache/', import.meta.url));
env.allowLocalModels = false;

let extractorPromise = null;

/**
 * Loads the embedding model once, lazily. First call downloads ~90 MB.
 * `quantized: false` keeps the fp32 weights — the int8 export drifts a few
 * decimal places per dimension, which is enough to make new vectors sit
 * slightly off from ones the Python pipeline already wrote.
 */
export function getExtractor() {
  if (!extractorPromise) {
    console.log(`Loading embedding model ${config.embeddingModel} (first run downloads ~90MB)...`);
    extractorPromise = pipeline('feature-extraction', config.embeddingModel, {
      quantized: false,
    }).then((extractor) => {
      extractor.tokenizer.model_max_length = config.embeddingMaxTokens;
      console.log('Embedding model ready.');
      return extractor;
    });
  }
  return extractorPromise;
}

/** Warms the model at boot so the first user request isn't the one that pays. */
export async function warmUp() {
  await embedText('warm up');
}

export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function embedBatch(texts) {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });

  const [rows, dims] = output.dims;
  const flat = output.data;
  const vectors = [];
  for (let i = 0; i < rows; i++) {
    vectors.push(Array.from(flat.slice(i * dims, (i + 1) * dims)));
  }
  return vectors;
}

/**
 * Adds an `embedding` (384 floats) to every chunk, in batches.
 * @param {(update: {done: number, total: number}) => void} [onProgress]
 */
export async function embedChunks(chunks, onProgress = () => {}) {
  const batchSize = config.embeddingBatchSize;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await embedBatch(batch.map((chunk) => chunk.content));

    batch.forEach((chunk, index) => {
      chunk.embedding = vectors[index];
    });

    onProgress({ done: Math.min(i + batchSize, chunks.length), total: chunks.length });
  }

  return chunks;
}
