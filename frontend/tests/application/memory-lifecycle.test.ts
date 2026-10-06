import { afterEach, expect, it, vi } from 'vitest';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import type { MemoryRepositories } from '../../src/application/ports/memory-runtime';
import type { MemoryResult, PersistedCharacterStateSnapshot } from '../../src/application/ports/memory-repository.interface';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime('2026-09-18T00:00:00.000Z'); let id = 0;
  const character = new CharacterStateService({ now: Date.now });
  const storage = {
    ready: Promise.resolve({ ok: true, value: undefined } as const),
    history: { appendTurn: vi.fn<MemoryRepositories['history']['appendTurn']>(async () => ({ ok: true, value: undefined })), getRecent: vi.fn<MemoryRepositories['history']['getRecent']>(async () => ({ ok: true, value: [] })), closeSession: vi.fn<MemoryRepositories['history']['closeSession']>(async () => ({ ok: true, value: undefined })), closeUnfinishedSessions: vi.fn<MemoryRepositories['history']['closeUnfinishedSessions']>(async () => ({ ok: true, value: undefined })) },
    episodes: { append: vi.fn<MemoryRepositories['episodes']['append']>(async () => ({ ok: true, value: undefined })) },
    facts: { upsert: vi.fn<MemoryRepositories['facts']['upsert']>(async fact => ({ ok: true, value: fact })), removeByKey: vi.fn<MemoryRepositories['facts']['removeByKey']>(async () => ({ ok: true, value: undefined })), list: vi.fn<MemoryRepositories['facts']['list']>(async () => ({ ok: true, value: [] })) },
    character: { load: vi.fn<MemoryRepositories['character']['load']>(async () => ({ ok: true, value: null })), save: vi.fn<MemoryRepositories['character']['save']>(async () => ({ ok: true, value: undefined })) },
    clear: { clearUserMemory: vi.fn<MemoryRepositories['clear']['clearUserMemory']>(async () => ({ ok: true, value: undefined })) },
    close: vi.fn(async () => {}), abort: vi.fn(async () => {}),
  };
  const start = vi.fn(), pause = vi.fn(), resume = vi.fn(), resetCommitted = vi.fn(), hydrate = vi.fn();
  const lifecycle = new MemoryLifecycle({ storage, character, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, now: Date.now, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`, toTimestamp: ms => new Date(ms).toISOString(), localMock: true, start, pause, resume, resetCommitted, hydrate });
  return { lifecycle, storage, character, start, pause, resume, resetCommitted, hydrate };
}
afterEach(() => vi.useRealTimers());
it('restores once before start, hydrates Mock and checkpoints only dirty state at five-second cadence', async () => {
  const f = fixture(); const saved = f.character.getState(); saved.relationship.friendship = 321;
  f.storage.character.load.mockResolvedValue({ ok: true, value: projectCharacterMemory(saved, new Date().toISOString()) });
  f.start.mockImplementation(() => expect(f.character.getState().relationship.friendship).toBe(321));
  await f.lifecycle.initialize(); expect(f.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: 'restored' });
  await vi.advanceTimersByTimeAsync(5000); expect(f.storage.character.save).not.toHaveBeenCalled();
  f.character.applyStimulus({ type: 'user_message', source: 'user', createdAt: new Date().toISOString(), text: 'hello' });
  await vi.advanceTimersByTimeAsync(4999); expect(f.storage.character.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(f.storage.character.save).toHaveBeenCalledTimes(1); await f.lifecycle.shutdown();
});
it('first input starts defaults immediately and discards a late restore completely', async () => {
  const f = fixture(); const pending = deferred<MemoryResult<PersistedCharacterStateSnapshot | null>>();
  f.storage.character.load.mockReturnValue(pending.promise); const initialization = f.lifecycle.initialize(); await Promise.resolve(); await Promise.resolve();
  expect(f.lifecycle.admitInput()).toBe(true); expect(f.start).toHaveBeenCalledTimes(1);
  const old = f.character.getState(); old.relationship.friendship = 999;
  pending.resolve({ ok: true, value: projectCharacterMemory(old, new Date().toISOString()) }); await initialization;
  expect(f.character.getState().relationship.friendship).toBe(0); expect(f.hydrate).not.toHaveBeenCalled(); expect(f.storage.abort).toHaveBeenCalled();
  expect(f.lifecycle.getStatus()).toEqual({ mode: 'volatile', reason: 'unavailable' }); await f.lifecycle.shutdown();
});
it('enforces the ten-second deadline across restore reads, not only worker initialization', async () => {
  const f = fixture(); const pending = deferred<MemoryResult<PersistedCharacterStateSnapshot | null>>();
  f.storage.character.load.mockReturnValue(pending.promise); const initializing = f.lifecycle.initialize(); await vi.advanceTimersByTimeAsync(10_000);
  expect(f.start).toHaveBeenCalledTimes(1); expect(f.lifecycle.getStatus().mode).toBe('volatile'); pending.resolve({ ok: true, value: null }); await initializing; await f.lifecycle.shutdown();
});
it.each(['invalid', 'future', 'malformed-envelope'])('protects %s snapshot from automatic overwrite, including shutdown', async kind => {
  const f = fixture();
  f.storage.character.load.mockResolvedValue(kind === 'malformed-envelope' ? { ok: false, code: 'invalid_data' } : { ok: true, value: { snapshotVersion: kind === 'future' ? 2 : 1, state: {}, updatedAt: new Date().toISOString() } });
  await f.lifecycle.initialize(); expect(f.lifecycle.getStatus()).toEqual({ mode: 'persistent', characterRestore: kind === 'future' ? 'unsupported_snapshot' : 'invalid_snapshot' });
  await vi.advanceTimersByTimeAsync(10_000); await f.lifecycle.shutdown(); expect(f.storage.character.save).not.toHaveBeenCalled();
});
it('does not interpret a busy or failed snapshot read as an empty persisted character', async () => {
  const f = fixture(); f.storage.character.load.mockResolvedValue({ ok: false, code: 'busy' }); await f.lifecycle.initialize();
  expect(f.lifecycle.getStatus()).toEqual({ mode: 'volatile', reason: 'busy' }); await vi.advanceTimersByTimeAsync(5000); expect(f.storage.character.save).not.toHaveBeenCalled(); await f.lifecycle.shutdown();
});
it('reset stops admission, preserves state until commit, then clears it and rotates app identity', async () => {
  const f = fixture(); await f.lifecycle.initialize(); f.character.applyStimulus({ type: 'user_message', source: 'user', createdAt: new Date().toISOString(), text: 'hi' });
  const before = f.character.getState(); const pending = deferred<MemoryResult<void>>(); f.storage.clear.clearUserMemory.mockReturnValue(pending.promise);
  const resetting = f.lifecycle.reset(); expect(f.lifecycle.admitInput()).toBe(false); expect(f.character.getState()).toEqual(before); expect(f.pause).toHaveBeenCalledTimes(1);
  expect(f.storage.clear.clearUserMemory).toHaveBeenCalledWith({ generation: 1 });
  pending.resolve({ ok: true, value: undefined }); expect(await resetting).toEqual({ ok: true, value: undefined });
  expect(f.character.getState().relationship.friendship).toBe(0); expect(f.resetCommitted).toHaveBeenCalledTimes(1); expect(f.resume).toHaveBeenCalledTimes(1);
  await f.lifecycle.history.completed({ memoryGeneration: 0, user: { id: 'u', text: 'old', createdAt: new Date().toISOString() }, assistant: { id: 'a', text: 'old', createdAt: new Date().toISOString() } });
  expect(f.storage.history.appendTurn).not.toHaveBeenCalled(); await f.lifecycle.shutdown();
});
it('rollback retains character data while advancing the generation and invalidating old callbacks', async () => {
  const f = fixture(); await f.lifecycle.initialize(); f.character.applyStimulus({ type: 'user_message', source: 'user', createdAt: new Date().toISOString(), text: 'hi' }); const before = f.character.getState();
  f.storage.clear.clearUserMemory.mockResolvedValue({ ok: false, code: 'conflict' }); expect(await f.lifecycle.reset()).toEqual({ ok: false, code: 'conflict' });
  expect(f.character.getState()).toEqual(before); expect(f.lifecycle.currentGeneration()).toBe(1); expect(f.resetCommitted).not.toHaveBeenCalled(); expect(f.lifecycle.getStatus().mode).toBe('persistent'); await f.lifecycle.shutdown();
});
it('cannot claim clearing a volatile unavailable database', async () => {
  const f = fixture(); f.lifecycle.admitInput(); expect(await f.lifecycle.reset()).toEqual({ ok: false, code: 'unavailable' }); expect(f.storage.clear.clearUserMemory).not.toHaveBeenCalled(); await f.lifecycle.shutdown();
});
it('ignores failed old checkpoints after successful reset', async () => {
  const f = fixture(); await f.lifecycle.initialize(); const pending = deferred<MemoryResult<void>>(); f.storage.character.save.mockReturnValueOnce(pending.promise);
  const writing = f.lifecycle.checkpoint(); await f.lifecycle.reset(); pending.resolve({ ok: false, code: 'io_error' }); await writing;
  expect(f.lifecycle.getStatus().mode).toBe('persistent'); await f.lifecycle.shutdown();
});
it('bounds shutdown even when storage never acknowledges a checkpoint', async () => {
  const f = fixture(); await f.lifecycle.initialize(); f.storage.character.save.mockReturnValue(new Promise(() => {}));
  const stopping = f.lifecycle.shutdown(); await vi.advanceTimersByTimeAsync(7000); await stopping; expect(f.storage.abort).toHaveBeenCalledTimes(1); expect(f.lifecycle.admitInput()).toBe(false);
});
it('explicit trusted facts preserve their source and return stale after a reset', async () => {
  const f = fixture(); await f.lifecycle.initialize(); const fact = { id: 'fact', factKey: 'name', factValue: 'Ира', confidence: 1, sourceMessageId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  expect(await f.lifecycle.upsertFact(fact)).toEqual({ ok: true, value: fact }); expect(f.storage.facts.upsert).toHaveBeenCalledWith(fact, { generation: 0 });
  expect(await f.lifecycle.removeFact('name')).toEqual({ ok: true, value: undefined }); await f.lifecycle.shutdown();
});
