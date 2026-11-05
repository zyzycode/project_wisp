import { afterEach, expect, it, vi } from 'vitest';
import { MemoryLifecycle } from '../../src/application/services/memory-lifecycle';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import type { CausalLifeEpisode } from '../../src/application/ports/causal-life.interface';
import type { MemoryRepositories } from '../../src/application/ports/memory-runtime';
const base = Date.parse('2026-11-05T10:00:00.000Z');
afterEach(() => vi.useRealTimers());
async function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(base); let id = 0;
  const mono = () => Date.now() - base;
  const character = new CharacterStateService({ now: Date.now, monotonicNow: mono });
  const storage = {
    ready: Promise.resolve({ ok: true, value: undefined } as const),
    history: { appendTurn: vi.fn(async () => ({ ok: true as const, value: undefined })), getRecent: vi.fn(async () => ({ ok: true as const, value: [] })), closeSession: vi.fn(async () => ({ ok: true as const, value: undefined })), closeUnfinishedSessions: vi.fn(async () => ({ ok: true as const, value: undefined })) },
    episodes: { append: vi.fn(async () => ({ ok: true as const, value: undefined })) },
    facts: { upsert: vi.fn<MemoryRepositories['facts']['upsert']>(), removeByKey: vi.fn(), list: vi.fn(async () => ({ ok: true as const, value: [] })) },
    character: { load: vi.fn(async () => ({ ok: true as const, value: null })), save: vi.fn<MemoryRepositories['character']['save']>(async () => ({ ok: true, value: undefined })) },
    causalLife: { append: vi.fn(async () => ({ ok: true as const, value: undefined })), getRecent: vi.fn(async () => ({ ok: true as const, value: [] })), resolveSources: vi.fn(async () => ({ ok: true as const, value: [] })) },
    clear: { clearUserMemory: vi.fn(async () => ({ ok: true as const, value: undefined })) }, close: vi.fn(async () => {}), abort: vi.fn(async () => {}),
  };
  const lifecycle = new MemoryLifecycle({ storage, character, scheduler: { setTimeout, clearTimeout: t => clearTimeout(t as ReturnType<typeof setTimeout>) },
    now: Date.now, monotonicNow: mono, timestamp: () => new Date().toISOString(), createId: () => `id-${++id}`,
    toTimestamp: at => new Date(base + at).toISOString(), localMock: false, start: vi.fn(), pause: vi.fn(), resume: vi.fn(), resetCommitted: vi.fn(), hydrate: vi.fn() });
  await lifecycle.initialize(); const state = character.getState();
  character.replaceRestoredState({ ...state, relationship: { ...state.relationship, resentment: 3 } });
  vi.advanceTimersByTime(30000);
  const interrupt: CausalLifeEpisode = { appRunId: lifecycle.history.currentAppRunId(), sequence: 2, revision: 1, occurredAt: new Date().toISOString(),
    source: 'user', triggerSequence: 1, activityRunId: 'interrupted', activity: 'cursor_game', cause: 'user_interrupted', outcome: 'cancelled',
    terminalReason: 'user_interaction', executedMs: 1500, participation: 'user_engaged' };
  lifecycle.relationshipRepair.observed(interrupt, mono()); lifecycle.relationshipRepair.committed(interrupt, { generation: 0 }, mono());
  vi.advanceTimersByTime(300000);
  const completed: CausalLifeEpisode = { ...interrupt, sequence: 3, occurredAt: new Date().toISOString(), source: 'autonomy', triggerSequence: null,
    activityRunId: 'completed', cause: 'completed', outcome: 'completed', terminalReason: null };
  lifecycle.relationshipRepair.observed(completed, mono());
  expect(character.getState().relationship.trust).toBe(500);
  return { lifecycle, character, storage, completed, mono };
}
it('flushes a same-profile shutdown reservation base-only before the final checkpoint and ignores late ack', async () => {
  const f = await fixture(); await f.lifecycle.shutdown();
  const snapshot = f.storage.character.save.mock.calls.at(-1)![0];
  expect(snapshot.snapshotVersion).toBe(5);
  expect(snapshot.state.relationship).toMatchObject({ trust: 501, resentment: 3 });
  expect(snapshot.state.relationshipRepair.lastRepairAt).toBeNull();
  f.lifecycle.relationshipRepair.committed(f.completed, { generation: 0 }, f.mono());
  expect(f.character.getState().relationship.trust).toBe(501);
  const restored = restoreCharacterMemory(snapshot, f.character.createDefaults(), Date.now());
  expect(restored.relationship.trust).toBe(501);
});
it('drops the old profile on full reset, including the old callback and its reserved base', async () => {
  const f = await fixture(); expect((await f.lifecycle.reset()).ok).toBe(true);
  f.lifecycle.relationshipRepair.committed(f.completed, { generation: 0 }, f.mono());
  vi.advanceTimersByTime(200);
  expect(f.character.getState().relationship).toMatchObject({ trust: 500, resentment: 0 });
  expect(f.character.getState().relationshipRepair.lastInterruptionAt).toBeNull();
  await f.lifecycle.shutdown();
});
