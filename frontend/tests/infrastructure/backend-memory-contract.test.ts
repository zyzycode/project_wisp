import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { parseBackendMemory, parseBackendMemoryError, parseBackendMemorySuccess, projectBackendMemoryRequest } from '../../src/infrastructure/ai/backend-memory-validation';
import { parseBackendSuccess } from '../../src/infrastructure/ai/backend-response-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { parseProviderResponse } from '../../src/application/services/dialogue-provider-result';
import { providerRequest } from './backend-ai-fixture';
import type { BackendMemoryRequest } from '../../src/application/ports/backend-memory-contract';

import { memoryTextLength } from '../../src/application/services/memory-recall';

function component(value: unknown) { if (!value || typeof value !== 'object') throw new Error('Expected fixture'); return Object.fromEntries(Object.entries(value).filter(([key]) => !["card", "effectPolicy", "appraisal"].includes(key))); }
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), '../docs/contracts/fixtures/desktop-backend-v1/memory', name), 'utf8'));
const request = fixture('request.valid.json') as BackendMemoryRequest;
const semantic = () => ({ ...providerRequest(), requestId: request.requestId, userMessage: { id: 'local', text: request.messages.at(-1)!.content, createdAt: '2026-09-18T00:00:00.000Z' }, characterSnapshot: request.character, memoryContext: request.memory });
afterEach(() => vi.useRealTimers());
it('validates shared memory fixtures and the core response shape', () => {
  expect(projectBackendMemoryRequest(semantic())).toEqual(component(request));
  expect(parseBackendMemorySuccess(component(fixture('response.success.json')), request.requestId, request.messages[0]!.content)).toEqual(component(fixture('response.success.json')));
  expect(parseBackendMemoryError(fixture('response.error.json'), request.requestId, 503)).toEqual(fixture('response.error.json'));
  expect(() => parseBackendSuccess(component(fixture('response.success.json')), request.requestId)).toThrow();
  expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThanOrEqual(32768);
  expect(memoryTextLength(request.memory)).toBeLessThanOrEqual(2400);
});
it.each([
  { ...request.memory, extra: true }, { ...request.memory, facts: [...request.memory.facts, request.memory.facts[0]] },
  { ...request.memory, episodes: [...request.memory.episodes, ...request.memory.episodes] },
  { ...request.memory, characterPreferences: [{ key: 'activity.cursor_game', value: 2, confidence: .49 }] },
  { ...request.memory, facts: [{ key: 'secret', value: 'token' }] },
  { ...request.memory, facts: [{ key: 'user.reply_style', value: 'aggressive' }] },
  ...[NaN, Infinity, -1, 60001, '1'].map(executedMs => ({ ...request.memory, episodes: [{ kind: 'cursor_game', outcome: 'caught', executedMs, occurredAt: '2026-09-18T00:00:00.000Z' }] })),
  ...['2026-02-30T00:00:00.000Z', '2026-01-01', '2026-01-01T00:00:00Z'].map(occurredAt => ({ ...request.memory, episodes: [{ kind: 'cursor_game', outcome: 'caught', executedMs: 1, occurredAt }] })),
])('rejects malformed bounded memory %j', memory => { expect(() => parseBackendMemory(memory)).toThrow(); });
it('counts all string values recursively, including registry keys and enum values', () => {
  expect(memoryTextLength({ key: 'activity.cursor_game', episodes: [{ kind: 'cursor_game', outcome: 'caught', occurredAt: '0000-01-01T00:00:00.000Z' }], value: 1 })).toBe('activity.cursor_gamecursor_gamecaught0000-01-01T00:00:00.000Z'.length);
  expect(parseBackendMemory({ facts: [], episodes: [{ kind: 'cursor_game', outcome: 'caught', executedMs: 0, occurredAt: '0000-01-01T00:00:00.000Z' }], characterPreferences: [] }).episodes).toHaveLength(1);
});
it('drops malformed/duplicate/source-mismatched proposals while retaining valid text/decision', () => {
  const base = { requestId: request.requestId, text: 'Ответ', decision: { behavior: 'play', confidence: 1 } };
  const candidate = { key: 'user.cursor_game', value: 'like', evidenceQuote: request.messages[0]!.content };
  for (const memoryCandidates of [[candidate, { key: 'user.cursor_game' }], [{ ...candidate, evidenceQuote: 'invented' }], [{ ...candidate, confidence: 1 }]]) {
    expect(parseBackendMemorySuccess({ ...base, memoryCandidates }, request.requestId, candidate.evidenceQuote)).toEqual({ ...base, memoryCandidates: [] });
  }
  expect(parseBackendMemorySuccess({ ...base, memoryCandidates: [candidate, candidate, candidate, candidate] }, request.requestId, candidate.evidenceQuote)).toEqual(base);
  const parsed = parseBackendMemorySuccess({ ...base, decision: { numericState: 5 }, memoryCandidates: [candidate] }, request.requestId, candidate.evidenceQuote);
  expect(parsed.decision).toBeUndefined(); expect(parsed.memoryCandidates).toEqual([candidate]);
  expect(() => parseBackendMemorySuccess({ ...base, numericState: 1 }, request.requestId, candidate.evidenceQuote)).toThrow();
});
it('performs exactly one explicitly selected v1 call and returns independently validated semantic candidates', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(fixture('response.success.json')), { headers: { 'Content-Type': 'application/json' } }));
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: () => 0, fetch: fetcher });
  const result = await provider.generateResponse(semantic());
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.com/v1/chat');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(request);
  expect(parseProviderResponse(result, request.requestId).memoryCandidates).toEqual([{ key: 'user.cursor_game', value: 'like', evidenceQuote: request.messages[0]!.content }]);
});
it('does not probe/downgrade/retry an unavailable v1 endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('not found', { status: 404 }));
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false, now: () => 0, fetch: fetcher });
  await expect(provider.generateResponse(semantic())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.com/v1/chat');
});
it('rejects unexpected envelope fields and drops fallback semantic proposals', () => {
  expect(() => parseBackendMemorySuccess({ unexpected: true, requestId: request.requestId, text: 'no' }, request.requestId, '')).toThrow();
  expect(() => parseBackendMemoryError({ unexpected: true, requestId: request.requestId, error: { code: 'upstream_unavailable' } }, request.requestId, 503)).toThrow();
  expect(parseProviderResponse({ requestId: 'r', status: 'fallback', reply: { text: 'Ответ' }, confidence: 0, memoryCandidates: [{ key: 'user.display_name', value: 'Bob', evidenceQuote: 'My name is Bob' }] }, 'r').memoryCandidates).toBeUndefined();
});
