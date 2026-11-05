import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseBackendMemory, projectBackendMemoryRequest } from '../../src/infrastructure/ai/backend-memory-validation';
import { providerRequest } from './backend-ai-fixture';
import { backendIntegrationFixture } from './backend-integration-fixture';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import type { AIProviderMemoryContext } from '../../src/application/ports/memory-knowledge.interface';
import { projectEventRequest, parseEventResponse } from '../../src/infrastructure/ai/backend-events-validation';

const directory = path.resolve('../docs/contracts/fixtures/desktop-backend-v1/causal-memory');
const read = (name: string): unknown => JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
it('accepts the shared source fact fixtures and rejects exact-shape/coherence/strict values', () => {
  for (const name of readdirSync(directory).filter(name => name !== 'invalid.json')) expect(parseBackendMemory(read(name)).episodes).toHaveLength(1);
  const invalid: unknown = read('invalid.json');
  if (!Array.isArray(invalid)) throw new Error('Invalid matrix');
  for (const value of invalid) expect(() => parseBackendMemory(value.memory), value.name).toThrow();
  const memory = parseBackendMemory(read('game.completed.json'));
  for (const executedMs of [NaN, Infinity, -Infinity]) expect(() => parseBackendMemory({ ...memory, episodes: [{ ...memory.episodes[0], executedMs }] })).toThrow();
  expect(projectBackendMemoryRequest({ ...providerRequest(), memoryContext: memory }).memory).toEqual(memory);
});
it('preserves the inherited event memory shape and its text-only response without new event triggers', () => {
  const memory = parseBackendMemory(read('game.completed.json')), base = providerRequest();
  const projected = projectEventRequest({ requestId: base.requestId, characterSnapshot: base.characterSnapshot, memoryContext: memory, locale: 'en', event: { type: 'social_bid_started', occurredAt: '2026-11-05T10:00:00.000Z' } });
  expect(projected.memory).toEqual(memory);
  expect(parseEventResponse({ requestId: base.requestId, text: 'A response' }, base.requestId)).toEqual({ requestId: base.requestId, replyText: 'A response' });
  expect(() => parseEventResponse({ requestId: base.requestId, text: 'A response', memory }, base.requestId)).toThrow();
});
it('sends the same fact once through real Python schemas and a stub provider without inferred feelings', async () => {
  const bridge = await backendIntegrationFixture();
  const client = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  try {
    const memory: AIProviderMemoryContext = parseBackendMemory(read('game.interrupted.json'));
    const result = await client.generateResponse({ ...providerRequest(), memoryContext: memory });
    expect(result.status).toBe('ok');
    expect(bridge.requests).toHaveLength(1);
    expect(bridge.requests[0]?.body).toMatchObject({ memory });
    expect(bridge.responses[0]?.upstreamMessages.some(message => message.content.includes('Actor is provenance, not motive'))).toBe(true);
  } finally { await bridge.close(); }
}, 15000);
