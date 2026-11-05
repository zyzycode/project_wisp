import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseBackendCausalExpression } from '../../src/infrastructure/ai/backend-causal-expression';
import { parseBackendMemory } from '../../src/infrastructure/ai/backend-memory-validation';
import { backendIntegrationFixture } from './backend-integration-fixture';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from './backend-ai-fixture';

function corpus(): Record<string, readonly unknown[]> {
  const value: unknown = JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/causal-expression/book.json'), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid corpus');
  return Object.fromEntries(Object.entries(value).map(([key, values]: [string, unknown]) => {
    if (!Array.isArray(values)) throw new Error('Invalid cases'); return [key, values];
  }));
}
it('accepts the independent activity-aware corpus, rejects forged book semantics and old wire names', () => {
  const values = corpus();
  for (const expression of values.expressions!) expect(() => parseBackendCausalExpression(expression)).not.toThrow();
  for (const expression of values.invalidExpressions!) expect(() => parseBackendCausalExpression(expression)).toThrow();
  const memory = (event: unknown) => ({ facts: [], episodes: [event], characterPreferences: [] });
  for (const event of values.events!) expect(() => parseBackendMemory(memory(event))).not.toThrow();
  for (const event of values.invalidEvents!) expect(() => parseBackendMemory(memory(event))).toThrow();
});
it('sends one bounded decorative book decision through Python and preserves no-text provenance', async () => {
  const bridge = await backendIntegrationFixture();
  const client = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  try {
    const expression = parseBackendCausalExpression(corpus().expressions![0]);
    const result = await client.generateResponse({ ...providerRequest(), causalExpression: expression });
    expect(result.status).toBe('ok'); expect(bridge.requests).toHaveLength(1);
    expect(bridge.responses[0]?.upstreamCalls).toBe(1);
    expect(bridge.responses[0]?.upstreamMessages.some(message => message.content.includes('decorative finite session') && message.content.includes('no text access'))).toBe(true);
  } finally { await bridge.close(); }
}, 15_000);
