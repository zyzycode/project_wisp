import { afterEach, expect, it, vi } from 'vitest';
import { MemoryCards } from '../../src/application/services/memory-cards';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import type { IMemoryItemsRepository, MemoryItemReceipt, MemoryItemMutation } from '../../src/application/ports/memory-items.interface';
import type { MemoryRepositories } from '../../src/application/ports/memory-runtime';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { MemoryCardCommandDTO } from '../../src/shared/ipc-contracts';
const now = '2026-10-17T00:00:00.000Z';
const command: MemoryCardCommandDTO = { kind: 'confirm', streamId: 'stream', sequence: 1, commandId: 'cmd', generation: 0,
  itemId: 'item', expectedRevision: 0, confirmed: true, content: { category: 'shared_joke', label: 'Шутка', text: '«Я король Луны»', occurredOn: null },
  source: { userMessageId: 'user', assistantMessageId: 'assistant' } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function receipt(c: MemoryItemMutation): MemoryResult<MemoryItemReceipt> { return { ok: true, value: { commandId: c.commandId, itemId: c.itemId, revision: c.expectedRevision + 1, outcome: c.kind === 'delete' ? 'deleted' : c.kind === 'withdraw' ? 'withdrawn' : 'active' } }; }
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const ok = async () => ({ ok: true, value: undefined } as const);
  const items = { confirm: vi.fn<IMemoryItemsRepository['confirm']>(async c => receipt(c)), update: vi.fn<IMemoryItemsRepository['update']>(async c => receipt(c)),
    withdraw: vi.fn<IMemoryItemsRepository['withdraw']>(async c => receipt(c)), delete: vi.fn<IMemoryItemsRepository['delete']>(async c => receipt(c)),
    list: vi.fn<IMemoryItemsRepository['list']>(async () => ({ ok: true, value: { items: [], nextCursor: null } })) };
  const save = vi.fn<MemoryRepositories['character']['save']>(ok), clear = vi.fn(ok), invalidateMemory = vi.fn();
  const storage: MemoryRepositories = { items, ready: ok(), history: { appendTurn: ok, getRecent: async () => ({ ok: true, value: [] }), closeSession: ok, closeUnfinishedSessions: ok },
    episodes: { append: ok }, facts: { upsert: async fact => ({ ok: true, value: fact }), removeByKey: ok, list: async () => ({ ok: true, value: [] }) },
    character: { load: async () => ({ ok: true, value: null }), save }, clear: { clearUserMemory: clear }, close: async () => {}, abort: vi.fn(async () => {}) };
  const lifecycle = new MemoryLifecycle({ storage, character: new CharacterStateService({ now: Date.now }), scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    now: Date.now, timestamp: () => now, createId: () => 'id', toTimestamp: () => now, localMock: true,
    hydrate: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), resetCommitted: vi.fn(), invalidateMemory });
  const cards = new MemoryCards(() => lifecycle, () => now); cards.replaceStream('stream');
  return { cards, lifecycle, items, save, clear, storage, invalidateMemory };
}
afterEach(() => vi.useRealTimers());
it('keeps quotes inert until an explicit command, advances generation and coalesces exact replay', async () => {
  const f = fixture(); await f.lifecycle.initialize();
  await f.cards.list({ streamId: 'stream', cursor: null, limit: 20 }); expect(f.items.confirm).not.toHaveBeenCalled();
  const waiting = deferred<MemoryResult<MemoryItemReceipt>>(); f.items.confirm.mockReturnValueOnce(waiting.promise);
  const first = f.cards.mutate(command); const replay = f.cards.mutate(command); expect(replay).toBe(first);
  expect(f.lifecycle.currentGeneration()).toBe(1); expect(f.invalidateMemory).toHaveBeenCalledTimes(1); expect(f.lifecycle.admitInput()).toBe(true);
  expect(await f.lifecycle.reset()).toEqual({ ok: false, code: 'unavailable' }); expect(f.clear).not.toHaveBeenCalled();
  expect(await f.cards.mutate({ ...command, sequence: 2, commandId: 'other', itemId: 'other', generation: 1 })).toMatchObject({ ok: false, code: 'busy' });
  const mutation = f.items.confirm.mock.calls[0]![0]; waiting.resolve(receipt(mutation));
  expect(await first).toMatchObject({ ok: true, generation: 1, receipt: { outcome: 'active' } }); expect(f.items.confirm).toHaveBeenCalledTimes(1);
  expect(f.items.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, content: command.content }), { generation: 1 });
  expect(await f.cards.mutate({ ...command, content: { ...command.content, text: 'Changed' } })).toMatchObject({ ok: false, code: 'conflict' });
  await f.lifecycle.shutdown();
});
it('does not admit scalar facts as important events and never writes while listing', async () => {
  const f = fixture(); await f.lifecycle.initialize();
  expect(await f.cards.mutate({ ...command, content: { ...command.content, category: 'important_event', text: 'Меня зовут Ира' } })).toMatchObject({ ok: false, code: 'invalid_data' });
  expect(f.items.confirm).not.toHaveBeenCalled(); expect(f.lifecycle.currentGeneration()).toBe(0); await f.lifecycle.shutdown();
});
it('invalidates a pending list at a mutation boundary and late mutation acknowledgement after dispose', async () => {
  const f = fixture(); await f.lifecycle.initialize();
  const page = deferred<Awaited<ReturnType<IMemoryItemsRepository['list']>>>(); f.items.list.mockReturnValueOnce(page.promise);
  const listing = f.cards.list({ streamId: 'stream', cursor: null, limit: 20 });
  const waiting = deferred<MemoryResult<MemoryItemReceipt>>(); f.items.confirm.mockReturnValueOnce(waiting.promise);
  const writing = f.cards.mutate(command); page.resolve({ ok: true, value: { items: [], nextCursor: null } });
  expect(await listing).toMatchObject({ ok: false, code: 'stale' });
  await f.lifecycle.shutdown(); waiting.resolve(receipt(f.items.confirm.mock.calls[0]![0]));
  expect(await writing).toMatchObject({ ok: false, code: 'stale' }); expect(f.lifecycle.isRunning()).toBe(false);
});
it('keeps the barrier on rollback and makes a lost acknowledgement unavailable without success', async () => {
  const f = fixture(); await f.lifecycle.initialize();
  f.items.confirm.mockResolvedValueOnce({ ok: false, code: 'conflict' });
  expect(await f.cards.mutate(command)).toMatchObject({ ok: false, code: 'conflict', generation: 1 });
  expect(f.lifecycle.getStatus().mode).toBe('persistent');
  f.items.confirm.mockRejectedValueOnce(new Error('private database path'));
  expect(await f.cards.mutate({ ...command, sequence: 2, commandId: 'second', generation: 1 })).toEqual({ ok: false, generation: 2, code: 'unavailable' });
  expect(f.lifecycle.getStatus()).toEqual({ mode: 'volatile', reason: 'unavailable' }); expect(f.storage.abort).toHaveBeenCalled(); await f.lifecycle.shutdown();
});
it('continues character checkpoint cadence when a mutation crosses the scheduled checkpoint', async () => {
  const f = fixture(); await f.lifecycle.initialize();
  const waiting = deferred<MemoryResult<MemoryItemReceipt>>(); f.items.confirm.mockReturnValueOnce(waiting.promise);
  const writing = f.cards.mutate(command); await vi.advanceTimersByTimeAsync(5000);
  waiting.resolve(receipt(f.items.confirm.mock.calls[0]![0])); await writing;
  await vi.advanceTimersByTimeAsync(5000); expect(f.save).toHaveBeenCalledTimes(1); await f.lifecycle.shutdown();
});
