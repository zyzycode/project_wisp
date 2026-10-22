import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { AIEventProviderRequest } from '../../src/application/ports/ai-event-provider.interface';
import type { BackendInteractionChatRequest, BackendInteractionTouchRequest } from '../../src/application/ports/backend-interaction-contract';
import { projectInteractionChat, projectInteractionTouch, parseInteractionChatResponse, parseInteractionTouchResponse, parseInteractionError } from '../../src/infrastructure/ai/backend-interaction-validation';
import { projectSummaryChat, parseSummaryRequest } from '../../src/infrastructure/ai/backend-summary-validation';
import { parseObservationRequest } from '../../src/infrastructure/ai/backend-observation-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';

const fixture = (name: string, feature = 'interaction'): unknown => JSON.parse(readFileSync(`../docs/contracts/fixtures/desktop-backend-v1/${feature}/${name}`, 'utf8'));
const chatWire = fixture('request.chat.json') as BackendInteractionChatRequest;
const touchWire = fixture('request.touch.json') as BackendInteractionTouchRequest;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetcher: typeof fetch) => new ExternalAIProviderClient({ baseUrl: 'https://example.com/api', development: false, now: Date.now, fetch: fetcher });
function chatInput(wire = chatWire): AIProviderRequest {
  return { requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, memoryContext: wire.memory,
    recentContext: [], userMessage: { id: 'local-only', text: wire.messages.at(-1)!.content, createdAt: 'local-only' },
    previousInitiative: wire.previousInitiative, summary: wire.summary,
    interaction: { card: wire.card, effectPolicy: wire.effectPolicy, ...(Object.hasOwn(wire, 'previousTouch') ? { previousTouch: wire.previousTouch } : {}) } };
}
function touchInput(wire = touchWire): AIEventProviderRequest {
  return { requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, event: { ...wire.event, occurredAt: 'local-only' },
    memoryContext: { facts: [], episodes: [], characterPreferences: [] }, interaction: { card: wire.card, effectPolicy: wire.effectPolicy } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());

it('matches shared touch/chat/error fixtures and retains full v1 context', () => {
  expect(projectInteractionChat(chatInput())).toEqual(chatWire);
  expect(projectInteractionTouch(touchInput())).toEqual(touchWire);
  expect(parseInteractionChatResponse(fixture('response.chat.json'), chatWire.requestId, chatInput().userMessage.text, 'suppressed')).toEqual(fixture('response.chat.json'));
  const touch = fixture('response.touch.json') as { text: string; appraisal: unknown };
  expect(parseInteractionTouchResponse(touch, touchWire.requestId, 'eligible')).toEqual({ requestId: touchWire.requestId, replyText: touch.text, appraisal: touch.appraisal });
  expect(parseInteractionError(fixture('response.error.json'), chatWire.requestId, 502)).toEqual(fixture('response.error.json'));
});
const invalid = fixture('invalid.json') as {
  requests: readonly { name: string; endpoint: string; value: unknown }[];
  responses: readonly { name: string; endpoint: string; effectPolicy: 'eligible' | 'suppressed'; value: unknown }[];
};
it.each(invalid.responses)('rejects the entire shared invalid response $name', entry => {
  expect(() => entry.endpoint.endsWith('touch')
    ? parseInteractionTouchResponse(entry.value, touchWire.requestId, entry.effectPolicy)
    : parseInteractionChatResponse(entry.value, chatWire.requestId, chatInput().userMessage.text, entry.effectPolicy)).toThrow();
});
// Wire-only fields are authored by the adapter; their ingress validation belongs to the backend.
const projectionCases = invalid.requests.filter(entry => /unknown-card|card-id|card-revision|card-bool-revision|card-mismatch|missing-policy|bad-policy|invalid-uuid|random-gesture|event-extra|trace-/u.test(entry.name));
it.each(projectionCases)('rejects shared invalid projection input $name before HTTP', async entry => {
  const fetcher = vi.fn<typeof fetch>();
  if (entry.endpoint.endsWith('touch')) await expect(client(fetcher).generateEvent(touchInput(entry.value as BackendInteractionTouchRequest))).rejects.toThrow();
  else await expect(client(fetcher).generateResponse(chatInput(entry.value as BackendInteractionChatRequest))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('routes both interactions through explicit v1 and returns only validated semantic appraisal', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(fixture('response.touch.json'))).mockResolvedValueOnce(json(fixture('response.chat.json')));
  const provider = client(fetcher);
  await expect(provider.generateEvent(touchInput())).resolves.toMatchObject({ appraisal: { category: 'supportive', intensity: 'low', confidence: 'clear' } });
  await expect(provider.generateResponse(chatInput())).resolves.toMatchObject({ status: 'ok', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' }, memoryCandidates: [], reply: { tone: 'warm' } });
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(['https://example.com/api/v1/touch', 'https://example.com/api/v1/chat']);
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(touchWire);
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual(chatWire);
  for (const call of fetcher.mock.calls) expect(call[1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
});
it('routes summary, events and observation through the shared v1 adapter', async () => {
  const summary = parseSummaryRequest(fixture('request.summary.json', 'summary'));
  const observation = parseObservationRequest(fixture('request.valid.json', 'observation'));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(fixture('response.summary.success.json', 'summary')))
    .mockResolvedValueOnce(json({ requestId: touchWire.requestId, text: 'Привет' }))
    .mockResolvedValueOnce(json(fixture('response.success.json', 'observation')));
  const provider = client(fetcher);
  expect(provider.canIncludeSummary(chatInput())).toBe(true);
  await provider.generateSummary({ requestId: summary.requestId, locale: summary.locale, pairs: summary.pairs }, new AbortController().signal);
  await provider.generateEvent({ ...touchInput(), interaction: undefined, event: { type: 'social_bid_started', occurredAt: '2026-10-17T00:00:00.000Z' } });
  await provider.generateObservation({ requestId: observation.requestId, locale: observation.locale, characterSnapshot: observation.character, observation: observation.observation }, new AbortController().signal);
  expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(['https://example.com/api/v1/summary', 'https://example.com/api/v1/events', 'https://example.com/api/v1/observation']);
});
it.each([401, 403, 404, 502, 503])('does not retry or downgrade a failed v1 request, HTTP %s', async status => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ requestId: touchWire.requestId, error: { code: status === 503 ? 'upstream_unavailable' : 'invalid_model_response' } }, status));
  await expect(client(fetcher).generateEvent(touchInput())).rejects.toThrow();
  const provider = client(fetcher);
  if (status === 502 || status === 503) await expect(provider.generateResponse(chatInput())).resolves.toMatchObject({ status: 'fallback' });
  else await expect(provider.generateResponse(chatInput())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(call => String(call[0]).includes('/v1/'))).toBe(true);
});
it.each(['touch', 'chat'] as const)('validates %s errors against request ID, HTTP status and envelope', kind => {
  const error = fixture('response.error.json') as Record<string, unknown>;
  for (const extra of [{ requestId: null }, { requestId: 'wrong' }, { extra: true }]) {
    expect(() => parseInteractionError({ ...error, ...extra }, kind === 'touch' ? touchWire.requestId : chatWire.requestId, 502)).toThrow();
  }
  expect(() => parseInteractionError(error, chatWire.requestId, 503)).toThrow();
});
it.each(['\ud800', '\udfff', '\u0085', '\r', 'x'.repeat(240) + ' '])('rejects invalid v1 text without trimming away overflow or controls', text => {
  const response = fixture('response.touch.json') as Record<string, unknown>;
  expect(() => parseInteractionTouchResponse({ ...response, text }, touchWire.requestId, 'eligible')).toThrow();
});
it('accepts UTF-16 boundary text, clear negative and uncertain touch without inventing effects', () => {
  const response = fixture('response.touch.json') as Record<string, unknown>;
  for (const category of ['supportive', 'playful', 'boundary', 'neutral'] as const) for (const confidence of ['clear', 'uncertain'] as const) {
    expect(parseInteractionTouchResponse({ ...response, text: '😀'.repeat(120), appraisal: { category, intensity: 'low', confidence } }, touchWire.requestId, 'eligible').replyText).toHaveLength(240);
  }
});
it('enforces suppressed touch and captures policy before transport resolves', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher), request = touchInput();
  const interaction = { card: touchWire.card, effectPolicy: 'suppressed' as 'eligible' | 'suppressed' };
  const pending = provider.generateEvent({ ...request, interaction });
  interaction.effectPolicy = 'eligible';
  resolve(json(fixture('response.touch.json')));
  await expect(pending).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['cancel', 'timeout'] as const)('ignores late v1 touch after %s without a second request', async kind => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher), pending = provider.generateEvent(touchInput());
  const rejected = expect(pending).rejects.toThrow();
  if (kind === 'cancel') { provider.cancel(touchWire.requestId); resolve(json(fixture('response.touch.json'))); }
  else await vi.advanceTimersByTimeAsync(12000);
  await rejected; resolve(json(fixture('response.touch.json')));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it('preserves the shared admission slot during pending v1 touch', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher), pending = provider.generateEvent(touchInput());
  await expect(provider.generateResponse(chatInput())).rejects.toThrow();
  await expect(provider.generateEvent(touchInput())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); resolve(json(fixture('response.touch.json'))); await pending;
});
it('drops summary when required v1 context crosses the final wire budget', () => {
  const request = chatInput();
  const full: AIProviderRequest = { ...request, userMessage: { ...request.userMessage, text: '漢'.repeat(240) },
    characterSnapshot: { ...request.characterSnapshot, personality: { ...request.characterSnapshot.personality, aiSelfConcept: '漢'.repeat(500) } },
    recentContext: Array.from({ length: 6 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'wisp', text: '漢'.repeat(i % 2 === 0 ? 240 : 2000), createdAt: '2026-10-17T00:00:00.000Z' })),
    memoryContext: { facts: [{ key: 'user.display_name', value: '漢'.repeat(80) }, { key: 'user.preferred_address', value: '漢'.repeat(80) }, { key: 'user.favorite_topic', value: '漢'.repeat(120) }],
      episodes: Array.from({ length: 2 }, () => ({ kind: 'dialogue', userText: '漢'.repeat(240), assistantText: '漢'.repeat(400), occurredAt: '2026-10-17T00:00:00.000Z' })), characterPreferences: [] },
    previousInitiative: { kind: 'social_bid', text: '漢'.repeat(240), createdAt: '2026-10-17T00:00:00.000Z' },
    interaction: { ...request.interaction!, previousTouch: { ...chatWire.previousTouch!, publishedText: '漢'.repeat(240) } } };
  let found = false;
  for (let length = 1000; length <= 1200; length += 10) {
    const candidate = { ...full, summary: { text: '漢'.repeat(length) } };
    if (!projectSummaryChat(candidate).summary || projectInteractionChat(candidate).summary) continue;
    const projected = projectInteractionChat(candidate);
    expect(projected.previousTouch).toEqual(candidate.interaction!.previousTouch);
    expect(new TextEncoder().encode(JSON.stringify(projected)).byteLength).toBeLessThanOrEqual(32768);
    expect(client(vi.fn()).canIncludeSummary(candidate)).toBe(false); found = true; break;
  }
  expect(found).toBe(true);
});
it.each(['chat', 'touch'] as const)('bounds ignored-abort %s settlement to 3s while keeping transport quarantined until fetch settles', async kind => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher);
  const pending = kind === 'chat' ? provider.generateResponse(chatInput()) : provider.generateEvent(touchInput());
  const settled = vi.fn();
  void pending.then(settled, settled);
  provider.cancel(chatWire.requestId);
  await vi.advanceTimersByTimeAsync(3000);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  await expect(provider.generateResponse(chatInput())).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(json(fixture(kind === 'chat' ? 'response.chat.json' : 'response.touch.json')));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(await provider.getStatus()).toEqual({ kind: 'ready' });
  expect(settled).toHaveBeenCalledTimes(1);
});
it('keeps aborted v1 summary in the shared slot until its ignored-abort HTTP settles', async () => {
  const summary = parseSummaryRequest(fixture('request.summary.json', 'summary'));
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; }));
  const provider = client(fetcher), controller = new AbortController();
  const pending = provider.generateSummary({ requestId: summary.requestId, locale: summary.locale, pairs: summary.pairs }, controller.signal);
  const rejected = expect(pending).rejects.toThrow(); controller.abort(); await rejected;
  await expect(provider.generateEvent(touchInput())).rejects.toThrow();
  expect(provider.canStartObservation()).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
  resolve(json(fixture('response.summary.success.json', 'summary')));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it.each(['offline', 'malformed', 'timeout'] as const)('settles v1 chat %s without downgrade or accepting late output', async mode => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (mode === 'offline') throw new TypeError('offline');
    if (mode === 'malformed') return json({ requestId: chatWire.requestId, text: 'Invalid without appraisal' });
    return new Promise(yes => { resolve = yes; });
  });
  const provider = client(fetcher), pending = provider.generateResponse(chatInput());
  if (mode === 'malformed') await expect(pending).rejects.toThrow();
  else {
    if (mode === 'timeout') await vi.advanceTimersByTimeAsync(12000);
    await expect(pending).resolves.toMatchObject({ status: 'fallback' });
  }
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0]?.[0])).toContain('/v1/chat');
  if (mode === 'timeout') {
    await expect(provider.generateEvent(touchInput())).rejects.toThrow();
    resolve(json(fixture('response.chat.json')));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
  expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it('preserves independent decision and memory candidate sanitization inside valid v1 appraisal', () => {
  const response = { requestId: chatWire.requestId, text: 'Ответ', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' },
    decision: { behavior: 'invented', confidence: 1 }, memoryCandidates: [{ key: 'user.display_name', value: 'Аня', evidenceQuote: 'not this user message' }] };
  const parsed = parseInteractionChatResponse(response, chatWire.requestId, 'Почему?', 'suppressed');
  expect(parsed).not.toHaveProperty('decision'); expect(parsed.memoryCandidates).toEqual([]); expect(parsed.text).toBe('Ответ');
});
