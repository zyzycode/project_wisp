import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import type { BackendPreviousTouchReaction } from '../../src/application/ports/backend-interaction-contract';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { DEFAULT_CHAT_CONTEXT_LIMITS } from '../../src/application/ports/memory-repository.interface';
import type { ISummaryRuntime } from '../../src/application/ports/summary';
import type { ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';
import type { BackendSummaryChatRequest } from '../../src/application/ports/backend-summary-contract';
import type { AIEventProviderRequest } from '../../src/application/ports/ai-event-provider.interface';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { parseSummaryRequest, parseSummaryResponse, parseSummaryChatResponse, parseSummaryError, projectSummaryChat } from '../../src/infrastructure/ai/backend-summary-validation';

function component(value: unknown) { if (!value || typeof value !== 'object') throw new Error('Expected fixture'); return Object.fromEntries(Object.entries(value).filter(([key]) => !["card", "effectPolicy", "appraisal"].includes(key))); }
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), '../docs/contracts/fixtures/desktop-backend-v1/summary', name), 'utf8'));
const summaryWire = parseSummaryRequest(fixture('request.summary.json'));
const chatWire = fixture('request.chat-summary.json') as BackendSummaryChatRequest;
const summaryInput = { requestId: summaryWire.requestId, locale: summaryWire.locale, pairs: summaryWire.pairs };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const success = (): Response => json(fixture('response.summary.success.json'));
function chatInput(wire: BackendSummaryChatRequest = chatWire): AIProviderRequest {
  return { interaction: { card: { id: 'curiousStubbornGirl', revision: 2 }, effectPolicy: 'suppressed' }, requestId: wire.requestId, locale: wire.locale, characterSnapshot: wire.character, memoryContext: wire.memory, previousInitiative: wire.previousInitiative,
    recentContext: [], userMessage: { id: 'local', text: wire.messages.at(-1)!.content, createdAt: 'local' }, ...(Object.hasOwn(wire, 'summary') ? { summary: wire.summary } : {}) };
}
const eventInput = (touch = false): AIEventProviderRequest => ({ interaction: { card: { id: 'curiousStubbornGirl', revision: 2 }, effectPolicy: 'suppressed' }, requestId: summaryWire.requestId, locale: 'ru', characterSnapshot: chatWire.character,
  memoryContext: chatWire.memory, event: touch ? { type: 'user_touch', variant: 'touch', occurredAt: '2026-10-17T00:00:00.000Z' } : { type: 'social_bid_started', occurredAt: '2026-10-17T00:00:00.000Z' } });
const client = (fetcher: typeof fetch): ExternalAIProviderClient => new ExternalAIProviderClient({ baseUrl: 'https://example.com/api', development: false, now: Date.now, fetch: fetcher });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(300000); });
afterEach(() => vi.useRealTimers());

it('shares v1 request/response/error fixtures with the server and preserves previousInitiative', () => {
  expect(parseSummaryRequest(fixture('request.summary.json'))).toEqual(fixture('request.summary.json'));
  for (const filename of ['request.chat.json', 'request.chat-summary.json']) {
    const wire = fixture(filename) as BackendSummaryChatRequest;
    expect(projectSummaryChat(chatInput(wire))).toEqual(component(wire));
  }
  expect(parseSummaryResponse(fixture('response.summary.success.json'), summaryWire.requestId)).toEqual(fixture('response.summary.success.json'));
  expect(parseSummaryChatResponse(component(fixture('response.chat.success.json')), chatWire.requestId, chatWire.messages.at(-1)!.content)).toEqual(component(fixture('response.chat.success.json')));
  expect(parseSummaryError(fixture('response.error.json'), summaryWire.requestId, 502)).toEqual(fixture('response.error.json'));
});
const invalid = fixture('invalid.json') as readonly { name: string; operation: string; request: unknown }[];
it.each(invalid)('rejects shared invalid fixture $name', test => {
  expect(() => test.operation === 'summary' ? parseSummaryRequest(test.request) : projectSummaryChat(chatInput(test.request as BackendSummaryChatRequest))).toThrow();
});
it('enforces exact UTF-16 source and output caps, Unicode controls and encoded request bytes', () => {
  const pairs = Array.from({ length: 4 }, () => ({ userText: '😀'.repeat(120), assistantText: 'я'.repeat(1760) }));
  expect(parseSummaryRequest({ ...summaryWire, pairs }).pairs).toEqual(pairs);
  expect(() => parseSummaryRequest({ ...summaryWire, pairs: pairs.map(pair => ({ ...pair, assistantText: pair.assistantText + 'x' })) })).toThrow();
  expect(() => parseSummaryRequest({ ...summaryWire, pairs: Array.from({ length: 4 }, () => ({ userText: 'x', assistantText: 'x'.repeat(2001) })) })).toThrow();
  expect(() => parseSummaryRequest({ ...summaryWire, pairs: [...summaryWire.pairs, ...summaryWire.pairs, summaryWire.pairs[0]] })).toThrow();
  expect(() => parseSummaryRequest({ ...summaryWire, pairs: Array.from({ length: 4 }, () => ({ userText: 'x', assistantText: '\ud800'.repeat(1999) })) })).toThrow();
  const response = { requestId: summaryWire.requestId, text: '😀'.repeat(600) };
  expect(parseSummaryResponse(response, summaryWire.requestId).text).toHaveLength(1200);
  expect(() => parseSummaryResponse({ ...response, text: response.text + 'x' }, summaryWire.requestId)).toThrow();
  expect(parseSummaryResponse({ ...response, text: 'line\nnext\tword' }, summaryWire.requestId).text).toContain('\n');
});
it('sends only selected pairs on explicit summary and uses the v1 chat endpoint with summary attribution', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(success()).mockResolvedValueOnce(json(fixture('response.chat.success.json')));
  const provider = client(fetcher);
  expect(await provider.getStatus()).toEqual({ kind: 'ready' }); expect(fetcher).not.toHaveBeenCalled();
  await expect(provider.generateSummary(summaryInput, new AbortController().signal)).resolves.toBe('Пользователь обсуждал космос.');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual(summaryWire);
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.com/api/v1/summary');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store' });
  await expect(provider.generateResponse(chatInput())).resolves.toMatchObject({ status: 'ok', reply: { text: 'Продолжим.' } });
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual(chatWire);
  expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://example.com/api/v1/chat');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('keeps event and touch projections distinct on the shared transport', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ requestId: summaryWire.requestId, text: 'Привет' })).mockResolvedValueOnce(json({ requestId: summaryWire.requestId, text: 'Мур', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }));
  const provider = client(fetcher); await provider.generateEvent(eventInput()); await provider.generateEvent(eventInput(true));
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://example.com/api/v1/events');
  expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ event: { type: 'social_bid_started' } });
  expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://example.com/api/v1/touch');
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ event: { type: 'user_touch', variant: 'touch' } });
});
it.each([{ requestId: 'wrong-id' }, { text: '' }, { text: ' ' }, { text: 'bad\u0000' }, { text: 'x'.repeat(1201) }, { decision: {} }, { sources: [] }])('rejects malformed summary response %j without retry', async extra => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ requestId: summaryWire.requestId, text: 'text', ...extra }));
  const provider = client(fetcher); await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it.each(['offline', '401', '403', '502', 'content-type', 'invalid-json', 'oversize'])('fails summary safely on %s without retries or downgrade', async kind => {
  const fetcher = vi.fn<typeof fetch>(async () => {
    if (kind === 'offline') throw new TypeError('offline');
    if (kind === 'content-type') return new Response('{}', { headers: { 'Content-Type': 'text/html' } });
    if (kind === 'invalid-json') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
    if (kind === 'oversize') return new Response(' '.repeat(17000) + '{}', { headers: { 'Content-Type': 'application/json' } });
    return json(fixture('response.error.json'), Number(kind));
  });
  const provider = client(fetcher); await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); expect(String(fetcher.mock.calls[0]?.[0])).toContain('/v1/summary');
  expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});
it('rejects invalid input and a pre-aborted operation before network admission', async () => {
  const fetcher = vi.fn<typeof fetch>(); const provider = client(fetcher), controller = new AbortController(); controller.abort();
  await expect(provider.generateSummary(summaryInput, controller.signal)).rejects.toThrow();
  await expect(provider.generateSummary({ ...summaryInput, pairs: [] }, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it.each(['timeout', 'cancel'] as const)('aborts summary on %s, ignores late success and releases its shared slot', async kind => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(json(fixture('response.chat.success.json')));
  const provider = client(fetcher), controller = new AbortController();
  const pending = provider.generateSummary(summaryInput, controller.signal); const rejected = expect(pending).rejects.toThrow();
  expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  if (kind === 'timeout') await vi.advanceTimersByTimeAsync(12000); else controller.abort();
  await rejected; expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true); expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  resolve(success()); await flush();
  await expect(provider.generateResponse(chatInput())).resolves.toMatchObject({ status: 'ok' }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('uses one shared slot across summary, chat and events without background admission', async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(yes => { resolve = yes; })); const provider = client(fetcher);
  const pending = provider.generateSummary(summaryInput, new AbortController().signal);
  await expect(provider.generateResponse(chatInput())).rejects.toThrow();
  await expect(provider.generateEvent(eventInput())).rejects.toThrow();
  await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1); resolve(success()); await pending;
  const chat = provider.generateResponse(chatInput());
  await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow();
  resolve(json(fixture('response.chat.success.json'))); await chat;
  const event = provider.generateEvent(eventInput());
  await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow();
  resolve(json({ requestId: summaryWire.requestId, text: 'Привет' })); await event; expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each([{ requestId: 'wrong-id' }, { text: 'bad\u0000' }, { summary: { text: 'forged' } }, { text: 'x'.repeat(2001) }])('rejects malformed v1 chat output %j without downgrading', async extra => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ requestId: chatWire.requestId, text: 'Ответ', ...extra }));
  await expect(client(fetcher).generateResponse(chatInput())).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('late aborted summary cannot free the slot belonging to a newer chat', async () => {
  let resolveSummary!: (response: Response) => void, resolveChat!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(yes => { resolveSummary = yes; })).mockImplementationOnce(() => new Promise(yes => { resolveChat = yes; }));
  const provider = client(fetcher), controller = new AbortController();
  const pending = provider.generateSummary(summaryInput, controller.signal); const rejected = expect(pending).rejects.toThrow(); controller.abort(); await rejected;
  await expect(provider.generateResponse(chatInput())).rejects.toThrow();
  resolveSummary(success()); await flush();
  const chat = provider.generateResponse(chatInput()); await flush(); expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
  await expect(provider.generateSummary(summaryInput, new AbortController().signal)).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(2);
  resolveChat(json(fixture('response.chat.success.json'))); await chat; expect(await provider.getStatus()).toEqual({ kind: 'ready' });
});

it('restores ordinary recall when valid Unicode context makes summary exceed the actual wire byte cap', async () => {
  let request = chatInput();
  request.characterSnapshot = { ...request.characterSnapshot, personality: { ...request.characterSnapshot.personality, aiSelfConcept: '漢'.repeat(500) } };
  request.userMessage = { ...request.userMessage, text: '漢'.repeat(240) };
  request.recentContext = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 === 0 ? 'user' as const : 'wisp' as const, text: '漢'.repeat(i % 2 === 0 ? 240 : 2000), createdAt: '2026-10-17T00:00:00.000Z' }));
  const memory = { facts: [{ key: 'user.display_name' as const, value: '漢'.repeat(80) }, { key: 'user.preferred_address' as const, value: '漢'.repeat(80) }, { key: 'user.favorite_topic' as const, value: '漢'.repeat(120) }],
    episodes: Array.from({ length: 2 }, () => ({ kind: 'dialogue' as const, userText: '漢'.repeat(240), assistantText: '漢'.repeat(400), occurredAt: '2026-10-17T00:00:00.000Z' })), characterPreferences: [] };
  const summaryText = '漢'.repeat(1200), previousInitiative = { kind: 'social_bid' as const, text: '漢'.repeat(240), createdAt: '2026-10-17T00:00:00.000Z' };
  const previousTouch: BackendPreviousTouchReaction = { action: 'touch', occurredAt: '2026-10-17T00:00:00.000Z', publishedText: '漢'.repeat(240), appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' }, effect: 'neutral', reason: 'neutral', energyBand: 'rested', comfortBand: 'calm' };
  request = { ...request, interaction: { card: { id: 'curiousStubbornGirl', revision: 2 }, effectPolicy: 'suppressed', previousTouch } };
  const overflow = { ...request, memoryContext: memory, summary: { text: summaryText }, previousInitiative };
  const projection = projectInteractionChat(overflow);
  expect(projection).not.toHaveProperty('summary');
  expect(new TextEncoder().encode(JSON.stringify({ ...projection, summary: { text: summaryText } })).byteLength).toBeGreaterThan(32768);
  expect(new TextEncoder().encode(JSON.stringify(projection)).byteLength).toBeLessThan(32768);
  const restored = { ...memory, episodes: [{ kind: 'dialogue' as const, userText: 'covered source restored', assistantText: 'original source', occurredAt: '2026-10-17T00:00:00.000Z' }] };
  const recall = vi.fn<ILocalMemoryRecall['recall']>().mockResolvedValueOnce({ ok: true, value: memory }).mockResolvedValueOnce({ ok: true, value: restored });
  const summary: ISummaryRuntime = { preview: vi.fn(), confirm: vi.fn(), deleteSummary: vi.fn(), capture: vi.fn(async () => ({ text: summaryText, excludedMessageIds: ['covered-user', 'covered-assistant'], generation: 0 })), isCurrent: () => true, interrupt: vi.fn(), invalidate: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => { const body = JSON.parse(String(init?.body)); return json({ requestId: body.requestId, text: 'Ответ' }); });
  let id = 0;
  const runtime = new DialogueRuntime({ interactionEnabled: true, provider: client(fetcher), summary,
    events: { interruptForUser: async () => undefined, invalidate: vi.fn(), getPreviousTouch: () => previousTouch, takePreviousInitiative: () => previousInitiative },
    memory: { generation: () => 0, recall: { recall }, completed: vi.fn(), contextLimits: DEFAULT_CHAT_CONTEXT_LIMITS }, now: Date.now, timestamp: () => '2026-10-17T00:00:00.000Z',
    createId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => request.characterSnapshot, transaction: commit => commit(), applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.hydrateInitialContext(request.recentContext); runtime.replaceStream('s');
  runtime.receive({ type: 'send', streamId: 's', conversationId: runtime.getPresentation().conversationId, sequence: 1, text: request.userMessage.text });
  await flush();
  expect(recall).toHaveBeenCalledTimes(2);
  expect(recall.mock.calls[0]?.[0].excludedMessageIds).toEqual(['covered-user', 'covered-assistant']);
  expect(recall.mock.calls[1]?.[0].excludedMessageIds).toEqual([]);
  const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
  expect(sent).not.toHaveProperty('summary'); expect(sent.memory.episodes).toEqual(restored.episodes);
  expect(summary.confirm).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1); runtime.dispose();
});
