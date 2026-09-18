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
