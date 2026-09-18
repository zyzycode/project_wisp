import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { projectEventRequest, projectEventAwareChat, parseEventResponse, parseEventAwareChat, parseEventError } from '../../src/infrastructure/ai/backend-events-validation';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { AIRequestControl } from '../../src/application/services/ai-request-control';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from './backend-ai-fixture';
import type { BackendEventRequest, BackendEventAwareChatRequest } from '../../src/application/ports/backend-events-contract';
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), 'docs/contracts/fixtures/desktop-backend-v3', name), 'utf8'));
const game = fixture('request.game.json') as BackendEventRequest, social = fixture('request.social.json') as BackendEventRequest, chat = fixture('request.chat.json') as BackendEventAwareChatRequest;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(300000); });
afterEach(() => vi.useRealTimers());
it('matches all six common v3 fixtures without inventing a user message for events', () => {
  for (const request of [game, social]) {
    const projected = projectEventRequest({ requestId: request.requestId, event: request.event, characterSnapshot: request.character, memoryContext: request.memory, locale: request.locale });
    expect(projected).toEqual(request); expect(projected).not.toHaveProperty('messages');
  }
  expect(projectEventAwareChat({ ...providerRequest(), requestId: chat.requestId, characterSnapshot: chat.character, userMessage: { id: 'local', text: chat.messages.at(-1)!.content, createdAt: '' }, recentContext: [], memoryContext: chat.memory, previousInitiative: chat.previousInitiative })).toEqual(chat);
  expect(parseEventResponse(fixture('response.event.success.json'), game.requestId).replyText).toBeDefined();
  expect(parseEventError(fixture('response.error.json'), game.requestId, 503).version).toBe(3);
  expect(parseEventAwareChat(fixture('response.chat.success.json'), chat.requestId, chat.messages.at(-1)!.content)).toEqual(fixture('response.chat.success.json'));
});
it.each([{ decision: null }, { memoryCandidates: [] }, { delta: 1 }, { text: '' }, { text: 'x'.repeat(241) }, { version: 2 }, { requestId: 'wrong' }])('strictly rejects event output extension/bounds %j', extra => {
  expect(() => parseEventResponse({ version: 3, requestId: game.requestId, text: 'Привет', ...extra }, game.requestId)).toThrow();
});
it('does not expose source IDs or allow forged game outcomes/duration', () => {
  const request = { requestId: game.requestId, event: game.event, characterSnapshot: game.character, memoryContext: game.memory, locale: game.locale };
  expect(() => projectEventRequest({ ...request, event: { type: 'cursor_game_completed', outcome: 'caught', executedMs: 60001, occurredAt: '2026-09-18T00:00:00.000Z' } })).toThrow();
  const encoded = JSON.stringify(projectEventRequest(request)); expect(encoded).not.toContain('activityRunId'); expect(new TextEncoder().encode(encoded).byteLength).toBeLessThanOrEqual(32768);
});
it('hands the single HTTP slot to an accepted user only after aborted event fetch settlement', async () => {
  let active = 0, maximum = 0; const paths: string[] = []; let cancelled = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const pathname = new URL(String(input)).pathname; paths.push(pathname); active++; maximum = Math.max(maximum, active);
    if (pathname.endsWith('/events')) return new Promise<Response>((_yes, no) => {
      init?.signal?.addEventListener('abort', () => { cancelled = true; setTimeout(() => { active--; no(new Error('aborted')); }, 500); }, { once: true });
    });
    active--; const body: { requestId: string } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ version: 3, requestId: body.requestId, text: 'Ответ' }), { headers: { 'Content-Type': 'application/json' } });
  });
  const control = new AIRequestControl(), provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', apiVersion: 3, development: false, now: Date.now, requestControl: control, eventRequestControl: control, fetch: fetcher });
  let id = 0; const createId = () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`;
  const events = new AIEventRuntime({ provider, control, recall: { recall: async () => ({ ok: true, value: emptyMemoryContext() }) }, now: Date.now, timestamp: () => new Date().toISOString(), createId,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, character: () => providerRequest().characterSnapshot,
    gate: () => ({ allowed: true, activeRunId: 'social', localSpeech: false, memoryGeneration: 0, identity: 'current' }), publish: vi.fn() });
  const runtime = new DialogueRuntime({ provider, requestControl: control, events, now: Date.now, timestamp: () => new Date().toISOString(), createId,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, getCharacterSnapshot: () => providerRequest().characterSnapshot,
    applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(), transaction: commit => commit(), publish: vi.fn(), offerIntent: vi.fn() });
  runtime.replaceStream('s'); events.socialStarted('social', Date.now()); await flush();
  expect(paths).toEqual(['/v3/events']); expect(runtime.getPresentation().canSubmit).toBe(true);
  expect(runtime.receive({ type: 'send', text: 'Привет', sequence: 1, streamId: 's', conversationId: runtime.getPresentation().conversationId }).status).toBe('accepted');
  await flush(); expect(cancelled).toBe(true); expect(paths).toEqual(['/v3/events']);
  await vi.advanceTimersByTimeAsync(499); expect(paths).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(paths).toEqual(['/v3/events', '/v3/chat']); expect(maximum).toBe(1);
  expect(runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Ответ' }); expect(events.getSpeech()).toBeNull();
  for (let i = 0; i < 4; i++) expect(control.recordSubmission(Date.now())).toBe(true);
  expect(control.recordSubmission(Date.now())).toBe(false); // The aborted event remains charged.
  runtime.dispose(); events.dispose();
});
it('event transport aborts at3000ms without retries and rejects a later successful response', async () => {
  let resolve!: (response: Response) => void; let aborted = false;
  const control = new AIRequestControl();
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => { init?.signal?.addEventListener('abort', () => { aborted = true; }); return new Promise(yes => { resolve = yes; }); });
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://example.com', apiVersion: 3, development: false, now: Date.now, requestControl: control, eventRequestControl: control, fetch: fetcher });
  const pending = provider.generateEvent({ requestId: game.requestId, event: game.event, characterSnapshot: game.character, memoryContext: game.memory, locale: 'ru' });
  const rejected = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(3000); await rejected; expect(aborted).toBe(true);
  resolve(new Response(JSON.stringify(fixture('response.event.success.json')), { headers: { 'Content-Type': 'application/json' } })); await flush(); expect(fetcher).toHaveBeenCalledTimes(1);
});
