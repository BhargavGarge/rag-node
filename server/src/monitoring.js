import { watch } from 'agentwatch';
import { config } from './config.js';

/**
 * AgentWatch integration.
 *
 * The agent function is wrapped with the SDK's `watch()`, which traces every
 * run automatically — input, output, model, latency, tokens, errors.
 *
 * The wrapped function takes the user's question as its *first* argument on
 * purpose: `watch()` traces `args[0]` as the input, and we want that to be the
 * question, not the stuffed RAG prompt (question + eight code chunks). Drift
 * scored on the stuffed prompt measures retrieval churn, not answer quality,
 * and re-anchors every time chunking changes.
 *
 * Runs are also mirrored into a local ring buffer exposed at `GET /traces`, so
 * you can see what was captured without opening the dashboard.
 */

const MAX_TRACES = 200;
const traces = [];

export const enabled = Boolean(
  config.agentWatch.apiKey && config.agentWatch.agentId,
);

console.log(
  enabled
    ? `AgentWatch: enabled (agent ${config.agentWatch.agentId}${
        config.agentWatch.endpoint ? ` via ${config.agentWatch.endpoint}` : ''
      })`
    : 'AgentWatch: disabled (AGENTWATCH_API_KEY / AGENTWATCH_AGENT_ID not set)',
);

/**
 * Wraps an agent function `(question, options) => { answer, model, usage }`.
 * Unconfigured, tracing is skipped — `watch()` throws without a key, and
 * monitoring must never be able to take down /query.
 */
export function watchAgent(fn, agentInstructions) {
  const traced = enabled
    ? watch(fn, {
        apiKey: config.agentWatch.apiKey,
        agentId: config.agentWatch.agentId,
        // Only pass endpoint when set: the SDK falls back on `undefined`, but
        // an empty string would be used as-is.
        ...(config.agentWatch.endpoint
          ? { endpoint: config.agentWatch.endpoint }
          : {}),

        agentInstructions,
        metadata: { service: 'devdocs-ai', runtime: 'node' },
        debug: true,
      })
    : fn;

  return async (question, options) => {
    const entry = { at: new Date().toISOString(), input: question, status: 'success' };
    const started = performance.now();

    try {
      const result = await traced(question, options);
      entry.output = result.answer;
      entry.model = result.model;
      return result;
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      throw err;
    } finally {
      entry.latencyMs = Math.round(performance.now() - started);
      traces.unshift(entry);
      if (traces.length > MAX_TRACES) traces.length = MAX_TRACES;
    }
  };
}

export function recentTraces(limit = 50) {
  return traces.slice(0, limit);
}
