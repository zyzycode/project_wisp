import { expect, it, vi } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { MemoryHistory } from '../../src/application/services/memory-history';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import type { IAIEventProvider } from '../../src/application/ports/ai-event-provider.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryWorkerClient, type MemoryWorker } from '../../src/infrastructure/memory/worker-client';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { createMemoryAdapters } from '../../src/infrastructure/memory/adapters';
import { command } from '../../src/infrastructure/memory/protocol';
import { MemoryKnowledge } from '../../src/application/services/memory-knowledge';
import { LocalMemoryRecall } from '../../src/application/services/memory-recall';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { backendIntegrationFixture } from '../infrastructure/backend-integration-fixture';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
it.each([true, false])('sends touch after the real click reaction with autonomy enabled=%s', async enabled => {
  const f = fixture(); f.main.setEnabled(enabled);
  f.input.execute({ type: 'click' }); f.main.handleCharacterInteraction('click'); f.events.touch();
  await flush();
  expect(f.generateEvent).toHaveBeenCalledTimes(1);
  expect(f.generateEvent.mock.calls[0]?.[0].event.type).toBe('user_touch');
  expect(f.events.getSpeech()).not.toBeNull();
  expect(f.append).not.toHaveBeenCalled();
  f.main.beginDrag(); expect(f.events.getSpeech()).toBeNull();
  f.main.dispose(); f.events.dispose();
});
function fixture(social = false) {
  let events: AIEventRuntime | undefined, history: MemoryHistory | undefined, id = 0;
  const f = scenario(social ? { attention: 85, play: 30, boredom: 20 } : {}, social ? .99 : 0, undefined, undefined, {
    onActivityStarted: () => events?.activityStarted(), onSocialBidStarted: (runId, atMs) => events?.socialStarted(runId, atMs),
    onCursorGameResult: result => { events?.gameTerminal(result, 0); void history?.game(result, 0); }, onActivityOutcome: event => events?.outcome(event),
    onAIInvalidated: () => events?.invalidate(), onUserContact: () => events?.userContact(),
  });
  const timers = new Map<number, { at: number; callback: () => void }>();
  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => ({ requestId: request.requestId, replyText: 'Вспомним нашу игру?' }));
  events = new AIEventRuntime({ provider: { generateEvent, cancel: vi.fn() },
    recall: { recall: async () => ({ ok: true, value: emptyMemoryContext() }) }, now: f.now, timestamp: () => new Date(f.now()).toISOString(), createId: () => `request-${++id}`,
    scheduler: { setTimeout: (callback, delay) => { const key = ++id; timers.set(key, { at: f.now() + delay, callback }); return key; }, clearTimeout: key => { timers.delete(key as number); } },
    character: () => f.character.getSnapshot(), gate: () => ({ ...f.main.getAIEventState(), memoryGeneration: 0, identity: 'stream:c:0' }), publish: vi.fn() });
  const append = vi.fn(async (): Promise<MemoryResult<void>> => ({ ok: true, value: undefined }));
  history = new MemoryHistory({ history: { appendTurn: vi.fn(), getRecent: vi.fn(), closeSession: vi.fn(), closeUnfinishedSessions: vi.fn() }, episodes: { append }, context: () => ({ generation: 0 }), createId: () => `memory-${++id}`, toTimestamp: time => new Date(time).toISOString(), onFailure: vi.fn(), gameObserver: events });
  const step = async (ms: number) => { f.advance(ms); events?.tick(); for (const [key, timer] of timers) if (timer.at <= f.now()) { timers.delete(key); timer.callback(); } await flush(); };
  return { ...f, events, append, generateEvent, step };
}
it('wires a real game terminal through acknowledged memory to optional speech without a second Character reward', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<void>) => void;
  f.append.mockImplementationOnce(() => new Promise(resolve => { ack = resolve; }));
  const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 }); sample();
  for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  for (let i = 0; i < 28; i++) { sample(); f.advance(100); }
  expect(f.outcomes).toMatchObject([{ family: 'cursor_interest', outcome: 'completed', playCompleted: true }]);
  expect(f.append).toHaveBeenCalledTimes(1); expect(f.generateEvent).not.toHaveBeenCalled();
  const relationship = f.character.getState().relationship;
  ack({ ok: true, value: undefined }); await flush(); await f.step(2000);
  expect(f.generateEvent).toHaveBeenCalledTimes(1); expect(f.events.getSpeech()?.text).toBe('Вспомним нашу игру?');
  expect(f.character.getState().relationship).toEqual(relationship); expect(f.append).toHaveBeenCalledTimes(1);
  f.main.dispose(); f.events.dispose();
});
it('wires actual SocialBid start after local admission; quiet cancels the speech without changing relationship', async () => {
  const f = fixture(true), relationship = f.character.getState().relationship;
  f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid'); await flush();
  expect(f.generateEvent).toHaveBeenCalledTimes(1); expect(f.events.getSpeech()).not.toBeNull();
  expect(f.append).not.toHaveBeenCalled(); f.main.setQuietMode(true); expect(f.events.getSpeech()).toBeNull();
  expect(f.character.getState().relationship).toEqual(relationship); f.main.dispose(); f.events.dispose();
});

class SqliteWorker extends EventEmitter implements MemoryWorker {
  constructor(private readonly store: SqliteMemoryStore) { super(); queueMicrotask(() => this.emit('message', { id: 0, result: { ok: true, value: undefined } })); }
  postMessage(value: unknown): void { const c = command(value); queueMicrotask(() => { this.emit('message', { id: c.id, result: this.store.execute(c) }); if (c.operation === 'close') { this.store.close(); this.emit('exit', 0); } }); }
  async terminate(): Promise<number> { this.store.close(); this.emit('exit', 0); return 0; }
}

async function backendGameFixture(holdEvent = false) {
  const bridge = await backendIntegrationFixture();
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wisp-v1-game-')), filename = path.join(directory, 'memory.sqlite');
  const toTimestamp = (ms: number) => new Date(Date.UTC(2026, 8, 18) + ms).toISOString();
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: toTimestamp(0), createWorker: () => new SqliteWorker(SqliteMemoryStore.open(filename, toTimestamp(0))) });
  const repos = createMemoryAdapters(client), failure = vi.fn(), publication = vi.fn();
  let events: AIEventRuntime | undefined, history: MemoryHistory | undefined, dialogue: DialogueRuntime | undefined;
  let gameWrite: Promise<void> | undefined, release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), eventArrived = new Promise<void>(resolve => { arrived = resolve; });
  const f = scenario({}, 0, undefined, undefined, {
    onActivityStarted: () => events?.activityStarted(), onSocialBidStarted: (id, at) => events?.socialStarted(id, at),
    onCursorGameResult: result => { events?.gameTerminal(result, 0); gameWrite = history?.game(result, 0); },
    onActivityOutcome: outcome => events?.outcome(outcome), onAIInvalidated: () => events?.invalidate(), onUserContact: () => events?.userContact(),
  });
  const close = async () => {
    release(); dialogue?.dispose(); events?.dispose(); f.main.dispose();
    try { await gameWrite; await history?.whenSettled(); await client.close(0); }
    finally { try { await bridge.close(); } finally { vi.useRealTimers(); rmSync(directory, { recursive: true, force: true }); } }
  };
  try {
    expect(await client.ready).toEqual({ ok: true, value: undefined });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const scheduler = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

    const fetcher: typeof fetch = async (input, init) => {
      const response = await bridge.fetch(input, init);
      if (new URL(String(input)).pathname === '/v1/events') { arrived(); if (holdEvent) await held; }
      return response;
    };
    const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: f.now, fetch: fetcher });
    const eventCalls = vi.spyOn(provider, 'generateEvent'), chatCalls = vi.spyOn(provider, 'generateResponse');
    const knowledge = new MemoryKnowledge({ facts: repos.facts, isCurrent: generation => generation === 0, createId: randomUUID, onFailure: failure, preferenceLearning: f.character });
    const recall = new LocalMemoryRecall({ ...repos, scheduler, isCurrent: generation => generation === 0, beforeRead: () => history!.whenSettled(), preference: () => f.character.getState().preferences['activity.cursor_game'], onFailure: failure });
    events = new AIEventRuntime({ provider, recall, now: f.now, timestamp: () => toTimestamp(f.now()), createId: randomUUID, scheduler,
      character: () => f.character.getSnapshot(), gate: () => ({ ...f.main.getAIEventState(), memoryGeneration: 0, identity: dialogue?.getIdentity() ?? null }), publish: publication });
    history = new MemoryHistory({ ...repos, context: () => ({ generation: 0 }), createId: randomUUID, toTimestamp, onFailure: failure, gameObserver: events, onPersisted: (turn, context) => knowledge.persisted(turn, context) });
    dialogue = new DialogueRuntime({ getSemanticSleepState: () => 'awake', interactionEnabled: true, provider, events,
      memory: { generation: () => 0, recall, completed: turn => { void history!.completed(turn); } }, now: f.now, timestamp: () => toTimestamp(f.now()), createId: randomUUID, scheduler,
      getCharacterSnapshot: () => f.character.getSnapshot(), applyStimulus: stimulus => f.character.applyStimulus(stimulus), beginThinking: () => {}, endThinking: () => {},
      transaction: commit => commit(), offerIntent: offer => f.main.offerDialogueIntent(offer),
      publish: () => { const value = dialogue!.getPresentation(); events!.observeDialogue(value); f.main.observeDialoguePresentation(value); } });
    dialogue.replaceStream('game-stream');
    const step = async (ms: number) => { f.advance(ms); events!.tick(); await vi.advanceTimersByTimeAsync(ms); await flush(); };
    const game = async () => {
      const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 }); sample();
      for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
      expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
      for (let i = 0; i < 30 && f.outcomes.length === 0; i++) { sample(); f.advance(100); }
      expect(f.outcomes).toMatchObject([{ family: 'cursor_interest', outcome: 'completed', playCompleted: true }]);
      expect(gameWrite).toBeDefined(); await gameWrite; await flush();
    };
    let acceptedChats = 0;
    const send = (sequence: number, text = 'да') => {
      const receipt = dialogue!.receive({ type: 'send', text, sequence, streamId: 'game-stream', conversationId: dialogue!.getPresentation().conversationId });
      if (receipt.status === 'accepted') acceptedChats++;
      return receipt;
    };
    const finishChat = async () => { await vi.waitFor(() => expect(chatCalls).toHaveBeenCalledTimes(acceptedChats), { timeout: 1000, interval: 1 }); const result = chatCalls.mock.results.at(-1); expect(result?.type).toBe('return'); await result?.value; await flush(); await history!.whenSettled(); };
    return { ...f, bridge, repos, events, dialogue, history, eventCalls, chatCalls, publication, failure, game, step, send, finishChat, eventArrived, release, close, timestamp: () => toTimestamp(f.now()) };
  } catch (error) { await close(); throw error; }
}

it('carries a committed real game through v1 events and the next accepted chat without fabricating history', async () => {
  const f = await backendGameFixture();
  try {
    await f.game();
    const persisted = await f.repos.gameReader.getRecent(10, { generation: 0 });
    expect(persisted.ok && persisted.value).toHaveLength(1); if (!persisted.ok) throw new Error('Game persistence failed');
    const episode = persisted.value[0]!;
    const relationship = f.character.getState().relationship;
    await f.step(1999); expect(f.bridge.requests).toHaveLength(0);
    await f.step(1); await f.eventArrived; await f.eventCalls.mock.results[0]?.value; await flush();
    expect(f.bridge.responses[0]?.status).toBe(200);
    const line = f.events.getSpeech(); expect(line?.text).toBe('Мне нравится игра с курсором');
    expect(f.character.getState().relationship).toEqual(relationship);
    expect(f.bridge.requests[0]).toMatchObject({ path: '/v1/events', body: { event: { type: 'cursor_game_completed', outcome: episode.outcome, executedMs: episode.executedMs, occurredAt: episode.endedAt },
      memory: { episodes: [{ kind: 'cursor_game', outcome: episode.outcome, executedMs: episode.executedMs, occurredAt: episode.endedAt }] } } });
    expect(f.bridge.requests[0]?.body).not.toHaveProperty('messages');
    expect(await f.repos.history.getRecent(10, { generation: 0 })).toEqual({ ok: true, value: [] });
    const prior = { kind: 'cursor_game', text: line!.text, createdAt: f.timestamp() };
    expect(f.dialogue.receive({})).toMatchObject({ status: 'rejected' });
    expect(f.send(1).status).toBe('accepted'); expect(f.send(2)).toMatchObject({ status: 'rejected', reason: 'busy' });
    await f.finishChat();
    expect(f.bridge.responses[1]?.status).toBe(200);
    expect(f.bridge.requests[1]).toMatchObject({ path: '/v1/chat', body: { messages: [{ role: 'user', content: 'да' }], previousInitiative: prior } });
    const previousBlock = f.bridge.responses[1]?.upstreamMessages.find(message => message.content.startsWith('Previous published AI initiative'));
    expect(JSON.parse(previousBlock?.content.split('\n').slice(1).join('\n') ?? 'null')).toEqual(prior);
    expect(f.dialogue.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Я отреагировала на твоё лёгкое касание.' });
    expect(f.send(3, 'Ещё раз').status).toBe('accepted'); await f.finishChat();
    expect(f.bridge.requests[2]?.body).not.toHaveProperty('previousInitiative');
    expect(f.bridge.requests[2]).toMatchObject({ path: '/v1/chat', body: { messages: [
      { role: 'user', content: 'да' }, { role: 'assistant', content: 'Я отреагировала на твоё лёгкое касание.' }, { role: 'user', content: 'Ещё раз' },
    ] } });
    const messages = await f.repos.history.getRecent(10, { generation: 0 });
    expect(messages.ok && messages.value.map(message => message.content)).toEqual(['да', 'Я отреагировала на твоё лёгкое касание.', 'Ещё раз', 'Я отреагировала на твоё лёгкое касание.']);
    expect(await f.repos.facts.list(10, { generation: 0 })).toEqual({ ok: true, value: [] });
    expect(await f.repos.gameReader.getRecent(10, { generation: 0 })).toEqual(persisted);
    expect(f.character.getState().preferences).toEqual({}); expect(f.failure).not.toHaveBeenCalled();
    expect(f.bridge.requests.map(request => request.path)).toEqual(['/v1/events', '/v1/chat', '/v1/chat']);
    expect(f.bridge.responses.map(response => response.upstreamCalls)).toEqual([1, 2, 3]);
  } finally { await f.close(); }
}, 20000);

it.each(['quiet', 'reset', 'dispose', 'deadline'] as const)('suppresses a real successful v1 response delivered after %s', async action => {
  const f = await backendGameFixture(true);
  try {
    await f.game(); const relationship = f.character.getState().relationship;
    await f.step(2000); await f.eventArrived;
    expect(f.bridge.responses[0]?.status).toBe(200); expect(f.events.getSpeech()).toBeNull();
    if (action === 'quiet') f.main.setQuietMode(true);
    if (action === 'reset') expect(f.dialogue.receive({ type: 'reset', sequence: 1, streamId: 'game-stream', conversationId: f.dialogue.getPresentation().conversationId }).status).toBe('accepted');
    if (action === 'dispose') { f.dialogue.dispose(); f.events.dispose(); f.main.dispose(); }
    if (action === 'deadline') await f.step(3000);
    f.release(); await expect(f.eventCalls.mock.results[0]?.value).rejects.toThrow(); await flush();
    expect(f.events.getSpeech()).toBeNull(); expect(f.events.takePreviousInitiative()).toBeUndefined();
    expect(f.publication).not.toHaveBeenCalled(); expect(f.chatCalls).not.toHaveBeenCalled();
    expect(f.character.getState().relationship).toEqual(relationship);
    expect(await f.repos.history.getRecent(10, { generation: 0 })).toEqual({ ok: true, value: [] });
    expect(await f.repos.facts.list(10, { generation: 0 })).toEqual({ ok: true, value: [] });
    const saved = await f.repos.gameReader.getRecent(10, { generation: 0 }); expect(saved.ok && saved.value).toHaveLength(1);
    expect(f.bridge.requests.map(request => request.path)).toEqual(['/v1/events']); expect(f.bridge.responses[0]?.upstreamCalls).toBe(1);
    expect(f.failure).not.toHaveBeenCalled();
  } finally { await f.close(); }
}, 20000);
