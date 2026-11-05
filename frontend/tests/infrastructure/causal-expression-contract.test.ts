import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseBackendCausalExpression } from '../../src/infrastructure/ai/backend-causal-expression';
import { parseBackendExpression, projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { projectInteractionTouch } from '../../src/infrastructure/ai/backend-interaction-validation';
import { projectEventRequest } from '../../src/infrastructure/ai/backend-events-validation';
import { parseObservationRequest } from '../../src/infrastructure/ai/backend-observation-validation';
import { fixture, providerRequest } from './backend-ai-fixture';
import { backendIntegrationFixture } from './backend-integration-fixture';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';

const read = (name: string): unknown => JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/causal-expression', name), 'utf8'));
it('validates the same exact bounded causal corpus independently of local models', () => {
  const full = parseBackendCausalExpression(read('full.json'));
  expect(parseBackendExpression(read('absent.json'), true)).toEqual({ romanceAllowed: false });
  expect(parseBackendExpression({ romanceAllowed: false, causal: full }, true)).toEqual({ romanceAllowed: false, causal: full });
  expect(() => parseBackendExpression({ romanceAllowed: false, causal: full })).toThrow();
  const invalid = read('invalid.json'); if (!Array.isArray(invalid)) throw new Error('Invalid matrix');
  for (const item of invalid) expect(() => parseBackendCausalExpression(item.value), item.name).toThrow();
  const request = { ...providerRequest(), causalExpression: full };
  expect(projectBackendRequest(request).character.expression.causal).toEqual(full);
  expect(projectBackendRequest(providerRequest()).character.expression).not.toHaveProperty('causal');
  expect(projectEventRequest({ requestId: request.requestId, event: { type: 'social_bid_started', occurredAt: '2026-11-05T10:00:00.000Z' },
    characterSnapshot: request.characterSnapshot, memoryContext: request.memoryContext!, locale: 'en', causalExpression: full }).character.expression.causal).toEqual(full);
  expect(projectInteractionTouch({ requestId: request.requestId, event: { type: 'user_touch', variant: 'touch', occurredAt: '2026-11-05T10:00:00.000Z' },
    characterSnapshot: request.characterSnapshot, memoryContext: request.memoryContext!, locale: 'en', causalExpression: full,
    interaction: { card: { id: 'curiousStubbornGirl', revision: 3 }, effectPolicy: 'suppressed' } }).character.expression.causal).toEqual(full);
  const observation = fixture('observation/request.valid.json');
  if (!observation || typeof observation !== 'object' || !('character' in observation) || !observation.character || typeof observation.character !== 'object') throw new Error('Invalid fixture');
  const observedCharacter = observation.character;
  expect(() => parseObservationRequest({ ...observation, character: { ...observedCharacter, expression: { romanceAllowed: false, causal: full } } })).toThrow();
});
it('carries the exact causal decision through actual Python validation and prompt assembly in one request', async () => {
  const bridge = await backendIntegrationFixture();
  const client = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  try {
    const causalExpression = parseBackendCausalExpression(read('full.json'));
    const result = await client.generateResponse({ ...providerRequest(), causalExpression });
    expect(result.status).toBe('ok'); expect(bridge.requests).toHaveLength(1);
    expect(bridge.requests[0]?.body).toMatchObject({ character: { expression: { causal: causalExpression } } });
    expect(bridge.responses[0]?.upstreamCalls).toBe(1);
    const messages = bridge.responses[0]!.upstreamMessages;
    expect(messages.filter(message => message.content.includes('Current desktop causal decision:'))).toHaveLength(1);
    expect(messages.some(message => message.content.includes('already chose this current causal intent and emotion'))).toBe(true);
    expect(messages.filter(message => message.content.includes('[Character card & current factual state]'))
      .every(message => !message.content.includes('user_interrupted'))).toBe(true);
  } finally { await bridge.close(); }
}, 15000);
