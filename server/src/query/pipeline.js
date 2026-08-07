import Groq from 'groq-sdk';
import { config } from '../config.js';
import { embedText } from '../ingestion/embedder.js';
import { searchChunks } from '../ingestion/store.js';
import { watchAgent } from '../monitoring.js';

const groq = new Groq({ apiKey: config.groqApiKey });

const SYSTEM_PROMPT = `You are a helpful code assistant analyzing a GitHub repository.
First figure out what kind of project this is (web app, mobile app, library, etc.) from the code.
Then answer the question based ONLY on the code excerpts provided.
Always mention which file the relevant code is in.
If you can't find a direct answer, explain what the provided code DOES show and suggest what to look for.
Never say "not provided" without also explaining what you DID find.`;

function buildContext(chunks) {
  return chunks
    .map(
      (chunk) =>
        `\n--- File: ${chunk.file_path} (similarity: ${chunk.similarity.toFixed(2)}) ---\n${chunk.content}\n`,
    )
    .join('');
}

function buildPrompt(question, chunks) {
  return `${SYSTEM_PROMPT}

QUESTION:
${question}

RELEVANT CODE FROM THE CODEBASE:
${buildContext(chunks)}

ANSWER:`;
}

function toSources(chunks) {
  return chunks.map((chunk) => ({
    file_path: chunk.file_path,
    similarity: Math.round(chunk.similarity * 1000) / 1000,
    preview: chunk.content.slice(0, 150),
  }));
}

/** Shared step 1+2: embed the question, pull the top-k nearest chunks. */
export async function retrieve(question, repo, topK = config.topK) {
  const queryEmbedding = await embedText(question);
  return searchChunks(queryEmbedding, repo, topK);
}

const NOT_INDEXED = 'This repo has not been indexed yet. Index it first, then ask again.';

/**
 * The traced agent: answer `question` from the retrieved `chunks`.
 *
 * Returns a normalized `{ answer, model, usage }` — the shape the AgentWatch
 * SDK reads output, model and token counts out of. Pass `emit` to stream
 * tokens as they arrive; the return value is the same either way.
 */
async function executeAgent(question, { chunks, emit }) {
  const messages = [{ role: 'user', content: buildPrompt(question, chunks) }];

  if (!emit) {
    const response = await groq.chat.completions.create({
      model: config.groqModel,
      messages,
      max_tokens: 1024,
      temperature: 0.1,
    });

    return {
      answer: response.choices[0]?.message?.content ?? '',
      model: response.model || config.groqModel,
      usage: response.usage,
    };
  }

  const stream = await groq.chat.completions.create({
    model: config.groqModel,
    messages,
    max_tokens: 1024,
    temperature: 0.1,
    stream: true,
    stream_options: { include_usage: true },
  });

  const parts = [];
  let usage = null;

  for await (const part of stream) {
    // The usage-bearing final chunk carries an empty `choices` array.
    if (!part.choices || part.choices.length === 0) {
      usage = part.usage ?? usage;
      continue;
    }
    const token = part.choices[0].delta?.content;
    if (token) {
      parts.push(token);
      emit({ type: 'token', content: token });
    }
  }

  return { answer: parts.join(''), model: config.groqModel, usage };
}

export const runAgent = watchAgent(executeAgent, SYSTEM_PROMPT);

/** Non-streaming answer — POST /query */
export async function answerQuestion(question, repo) {
  const chunks = await retrieve(question, repo);

  if (chunks.length === 0) {
    // Deliberately untraced: the LLM never ran and this string is identical
    // every time, so it would anchor the drift baseline to a constant that has
    // nothing to do with answer quality.
    return { answer: NOT_INDEXED, sources: [] };
  }

  const { answer } = await runAgent(question, { chunks });
  return { answer, sources: toSources(chunks) };
}

/**
 * Streaming answer — POST /query/stream.
 * Calls `emit(event)` with `{type: 'sources'|'token'|'done'|'error', content}`,
 * which the route serialises as SSE frames.
 */
export async function streamAnswer(question, repo, emit) {
  const chunks = await retrieve(question, repo);

  if (chunks.length === 0) {
    emit({ type: 'error', content: NOT_INDEXED });
    return;
  }

  emit({ type: 'sources', content: toSources(chunks) });

  try {
    await runAgent(question, { chunks, emit });
  } catch (err) {
    emit({ type: 'error', content: err.message });
    return;
  }

  emit({ type: 'done' });
}
