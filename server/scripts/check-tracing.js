/**
 * Verifies that traces are actually reaching AgentWatch.
 *   npm run check-tracing
 *
 * Sends one synthetic trace through the SDK and reports what the collector
 * said, which is otherwise invisible — the SDK is fire-and-forget by design.
 */
import 'dotenv/config';
import { AgentWatchClient } from 'agentwatch';
import { config } from '../src/config.js';

const { apiKey, agentId, endpoint } = config.agentWatch;

if (!apiKey || !agentId) {
  console.log('AgentWatch is disabled — set AGENTWATCH_API_KEY and AGENTWATCH_AGENT_ID.');
  process.exit(0);
}

console.log(`agentId:  ${agentId}`);
console.log(`apiKey:   ${apiKey.slice(0, 12)}…${apiKey.slice(-4)}`);
console.log(`endpoint: ${endpoint || '(SDK default)'}`);

const client = new AgentWatchClient({
  apiKey,
  agentId,
  ...(endpoint ? { endpoint } : {}),
});

const result = await client.trace({
  input: 'check-tracing: is delivery working?',
  output: 'synthetic trace from scripts/check-tracing.js',
  model: config.groqModel,
  latencyMs: 1,
  status: 'success',
  metadata: { service: 'devdocs-ai', synthetic: true },
});

console.log('\nresult:', JSON.stringify(result));

if (result.accepted) {
  console.log('\nTraces are being delivered.');
} else {
  const hints = {
    unauthorized:
      'The collector rejected the credentials (401/403). Check that the API key is valid\n' +
      '  for this collector and that AGENTWATCH_AGENT_ID names an agent registered under it.',
    network:
      'Could not reach the collector. Check the endpoint host and your connection.',
    timeout: 'The collector did not respond within the timeout.',
    invalid_payload: 'The collector rejected the payload shape (400).',
    rate_limited: 'Rate limited (429) — back off and retry.',
    server_error: 'The collector returned a server error.',
  };
  console.log(`\nNot delivered: ${result.reason}${result.status ? ` (HTTP ${result.status})` : ''}`);
  console.log(`  ${hints[result.reason] ?? ''}`);
  process.exitCode = 1;
}
