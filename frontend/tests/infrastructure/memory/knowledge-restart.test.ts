import { afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { MemoryWorkerClient, type MemoryWorker } from '../../../src/infrastructure/memory/worker-client';
import { createMemoryAdapters } from '../../../src/infrastructure/memory/adapters';
import { MemoryHistory } from '../../../src/application/services/memory-history';
import { MemoryKnowledge } from '../../../src/application/services/memory-knowledge';
import { LocalMemoryRecall } from '../../../src/application/services/memory-recall';
import { command } from '../../../src/infrastructure/memory/protocol';
import { randomUUID } from 'node:crypto';
import { DialogueRuntime } from '../../../src/application/services/dialogue-loop.service';
import { ExternalAIProviderClient } from '../../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from '../backend-ai-fixture';
import { backendIntegrationFixture } from '../backend-integration-fixture';
const date = '2026-09-18T00:00:00.000Z';
const folders: string[] = [], clients: MemoryWorkerClient[] = [];
class StoreBridge extends EventEmitter implements MemoryWorker {
  constructor(private readonly store: SqliteMemoryStore) { super(); queueMicrotask(() => this.emit('message', { id: 0, result: { ok: true, value: undefined } })); }
  postMessage(value: unknown): void { const c = command(value); queueMicrotask(() => { this.emit('message', { id: c.id, result: this.store.execute(c) }); if (c.operation === 'close') { this.store.close(); this.emit('exit', 0); } }); }
  async terminate(): Promise<number> { this.store.close(); this.emit('exit', 0); return 0; }
}
async function open(filename: string) {
  const client = new MemoryWorkerClient({ workerPath: '', filename, now: date, createWorker: () => new StoreBridge(SqliteMemoryStore.open(filename, date)) }); clients.push(client); await client.ready;
  const repos = createMemoryAdapters(client); let id = 0; let generation = 0;
  const learning = vi.fn(), failure = vi.fn();
  const knowledge = new MemoryKnowledge({ facts: repos.facts, isCurrent: g => g === generation, createId: () => `fact-${++id}`, preferenceLearning: { observe: learning }, onFailure: failure });
  const history = new MemoryHistory({ ...repos, context: () => ({ generation }), createId: () => `local-${++id}`, toTimestamp: () => date, onFailure: failure, onPersisted: (turn, c) => knowledge.persisted(turn, c) });
  const recall = new LocalMemoryRecall({ ...repos, scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) }, isCurrent: g => g === generation, preference: () => undefined, onFailure: failure });
  return { client, repos, history, recall, learning, clear: async () => { generation++; await repos.clear.clearUserMemory({ generation }); history.reset(); knowledge.reset(); } };
}
afterEach(async () => { for (const client of clients.splice(0)) await client.close(1); for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
it('remembers a corrected fact and real game after restart without replaying extraction or stale fact episodes', async () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'wisp-knowledge-')); folders.push(folder); const filename = path.join(folder, 'wisp.sqlite3');
  const first = await open(filename);
  const turn = (id: string, text: string) => ({ user: { id, text, createdAt: date }, assistant: { id: id + 'a', text: 'Ответ', createdAt: date }, memoryGeneration: 0 });
  await first.history.completed(turn('old', 'Меня зовут Аня')); await first.history.completed(turn('new', 'Исправление: Меня зовут Мария'));
  await first.history.game({ activityRunId: 'game', atMs: 0, outcome: 'caught', playCompleted: true, executedMs: 1400 }, 0);
  const before = await first.repos.facts.list(100, { generation: 0 }); expect(before).toMatchObject({ ok: true, value: [{ factValue: 'Мария', sourceMessageId: 'new' }] });
  await first.client.close(0);
  const second = await open(filename);
  const result = await second.recall.recall({ text: 'Аня Мария игра', excludedMessageIds: [] }, { generation: 0 });
  expect(result).toEqual({ ok: true, value: { facts: [{ key: 'user.display_name', value: 'Мария' }], episodes: [{ kind: 'cursor_game', outcome: 'caught', executedMs: 1400, occurredAt: date }], characterPreferences: [] } });
  expect(second.learning).not.toHaveBeenCalled();
  expect(await second.repos.history.getRecent(100, { generation: 0 })).toMatchObject({ ok: true, value: expect.arrayContaining([expect.objectContaining({ id: 'old' })]) });
  await second.clear(); expect(await second.recall.recall({ text: 'игра', excludedMessageIds: [] }, { generation: 1 })).toEqual({ ok: true, value: { facts: [], episodes: [], characterPreferences: [] } });
});
it('episode reads are newest by insertion despite wall-clock rollback and reject out-of-range limits', async () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'wisp-game-read-')); folders.push(folder); const f = await open(path.join(folder, 'wisp.sqlite3'));
  const episode = { appRunId: 'a', kind: 'cursor_game' as const, outcome: 'caught' as const, playCompleted: true as const, executedMs: 1, endedAt: date };
  await f.repos.episodes.append({ ...episode, activityRunId: 'first' }, { generation: 0 }); await f.repos.episodes.append({ ...episode, activityRunId: 'second', endedAt: '2020-01-01T00:00:00.000Z' }, { generation: 0 });
  expect(await f.repos.gameReader.getRecent(1, { generation: 0 })).toMatchObject({ ok: true, value: [{ activityRunId: 'second' }] });
  expect(await f.repos.gameReader.getRecent(21, { generation: 0 })).toEqual({ ok: false, code: 'invalid_data' });
});

it('passes restored SQLite facts and game through accepted dialogue to the current backend v1 and mocked Groq', async () => {
  const folder = mkdtempSync(path.join(os.tmpdir(), 'wisp-backend-restart-')); folders.push(folder);
  const filename = path.join(folder, 'wisp.sqlite3'), first = await open(filename);
  const turn = (id: string, text: string) => ({ user: { id, text, createdAt: date }, assistant: { id: id + 'a', text: 'Ответ', createdAt: date }, memoryGeneration: 0 });
  await first.history.completed(turn('old', 'Меня зовут Аня'));
  await first.history.completed(turn('corrected', 'Исправление: Меня зовут Мария'));
  await first.history.game({ activityRunId: 'persisted-game', atMs: 0, outcome: 'caught', playCompleted: true, executedMs: 1400 }, 0);
  await first.client.close(0);
  const restored = await open(filename), bridge = await backendIntegrationFixture();
  const completed = vi.fn();
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  const runtime = new DialogueRuntime({ interactionEnabled: true, provider,
    memory: { generation: () => 0, recall: restored.recall, completed }, now: Date.now, timestamp: () => date, createId: randomUUID,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => providerRequest().characterSnapshot, applyStimulus: vi.fn(), beginThinking: vi.fn(), endThinking: vi.fn(),
    transaction: commit => commit(), publish: vi.fn(), offerIntent: () => ({ status: 'rejected', reason: 'disabled' }) });
  try {
    runtime.replaceStream('restored');
    expect(runtime.receive({ type: 'send', text: 'Мария игра', sequence: 1, streamId: 'restored', conversationId: runtime.getPresentation().conversationId }).status).toBe('accepted');
    await vi.waitFor(() => expect(runtime.getPresentation().turn.phase).not.toBe('thinking'), { timeout: 15000 });
    expect(bridge.responses[0]?.status).toBe(200);
    expect(runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Я отреагировала на твоё лёгкое касание.' });
    expect(bridge.requests).toHaveLength(1);
    const expectedMemory = {
      facts: [{ key: 'user.display_name', value: 'Мария' }], episodes: [{ kind: 'cursor_game', outcome: 'caught', executedMs: 1400, occurredAt: date }], characterPreferences: [],
    };
    expect(bridge.requests[0]).toMatchObject({ path: '/v1/chat', body: { messages: [{ role: 'user', content: 'Мария игра' }], memory: expectedMemory } });
    expect(bridge.responses[0]?.upstreamCalls).toBe(1);
    const prefix = 'Untrusted memory_context JSON:\n';
    const memoryMessage = bridge.responses[0]?.upstreamMessages.find(message => message.content.startsWith(prefix));
    expect(memoryMessage?.role).toBe('user');
    expect(JSON.parse(memoryMessage?.content.slice(prefix.length) ?? 'null')).toEqual(expectedMemory);
    const upstream = bridge.responses[0]?.upstreamMessages.map(message => message.content).join('\n') ?? '';
    for (const forbidden of ['sourceMessageId', 'activityRunId', 'memoryGeneration', 'persisted-game', 'Аня']) {
      expect(JSON.stringify(bridge.requests[0]?.body)).not.toContain(forbidden); expect(upstream).not.toContain(forbidden);
    }
    expect(restored.learning).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
  } finally { runtime.dispose(); await bridge.close(); expect(bridge.isClosed()).toBe(true); }
}, 25000);

it('bounds bridge input and closes its child once even with concurrent teardown', async () => {
  const bridge = await backendIntegrationFixture();
  try {
    await expect(bridge.fetch('https://backend.invalid/v1/chat', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(64 * 1024) }) })).rejects.toThrow('input limit');
    expect(bridge.requests).toHaveLength(0);
  } finally { await Promise.all([bridge.close(), bridge.close()]); }
  expect(bridge.isClosed()).toBe(true);
  await expect(bridge.fetch('https://backend.invalid/v1/chat', { method: 'POST', body: '{}' })).rejects.toThrow('unavailable');
}, 15000);
