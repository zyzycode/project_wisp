import { afterEach, expect, it, vi } from 'vitest';
import { RelationshipRepairRuntime } from '../../src/application/services/relationship-repair-runtime';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import type { CausalLifeEpisode, ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import type { ICausalSourceReadBarrier } from '../../src/application/ports/life-history.interface';
const base = Date.parse('2026-11-05T10:00:00.000Z');
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(base);
  let generation = 0, available = true, appRunId = 'app', wallOffset = 0;
  const wallNow = () => Date.now() + wallOffset;
  const now = () => Date.now() - base;
  const character = new CharacterStateService({ now: wallNow, monotonicNow: now });
  const state = character.getState(); character.replaceRestoredState({ ...state, relationship: { ...state.relationship, resentment: 3 } });
  const repository: ICausalLifeRepository = { append: vi.fn(), getRecent: vi.fn(), resolveSources: vi.fn<ICausalLifeRepository['resolveSources']>(async () => ({ ok: true, value: [] })) };
  const barrier: ICausalSourceReadBarrier = { snapshot: () => ({ generation, revision: 0, pending: false }), whenSettled: async () => {} };
  const options = { character, repository, context: () => available ? { generation } : null, appRunId: () => appRunId, now,
    scheduler: { setTimeout, clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>) }, barrier };
  const runtime = new RelationshipRepairRuntime(options);
  const event = (sequence: number, cause: 'completed' | 'user_interrupted' = 'completed'): CausalLifeEpisode => ({ appRunId, sequence, revision: 1,
    occurredAt: new Date(wallNow()).toISOString(), source: cause === 'completed' ? 'autonomy' : 'user', activity: 'cursor_game',
    activityRunId: `game-${sequence}`, outcome: cause === 'completed' ? 'completed' : 'cancelled',
    terminalReason: cause === 'completed' ? null : 'user_interaction', cause, triggerSequence: cause === 'completed' ? null : sequence - 1,
    executedMs: 1500, participation: 'user_engaged' });
  const interrupt = () => { vi.advanceTimersByTime(30000); const e = event(2, 'user_interrupted'); runtime.observed(e, now()); runtime.committed(e, { generation }, now()); return e; };
  const complete = (sequence = 3) => { const e = event(sequence); runtime.observed(e, now()); return e; };
  return { character, runtime, event, interrupt, complete, now, repository, barrier, options,
    commit: (e: CausalLifeEpisode) => runtime.committed(e, { generation }, Date.parse(e.occurredAt) - base - wallOffset),
    setWallOffset: (value: number) => { wallOffset = value; },
    invalidate: () => { runtime.invalidate(); generation++; }, offline: () => { available = false; },
    reset: () => { character.resetToDefaults(); runtime.reset(); generation++; appRunId = 'next'; } };
}
it('separates time decay from new repair experience and atomically pays base+repair once', () => {
  const f = fixture(); f.interrupt(); const before = f.character.getState();
  vi.advanceTimersByTime(300000); f.character.tickNeeds(300000);
  expect(f.character.getState().relationship).toEqual(before.relationship);
  expect(f.character.getCausalEmotion()?.intensity).toBeLessThan(.2);
  const e = f.complete();
  expect(f.character.getCausalEmotion()?.kind).toBe('content');
  expect(f.character.getState().relationship).toEqual(before.relationship);
  expect(f.character.commitChat(f.character.beginChat(1), { category: 'supportive', intensity: 'low', confidence: 'clear' }).effect).toBe('suppressed');
  f.commit(e); const paid = f.character.getState();
  expect(paid.relationship).toMatchObject({ trust: before.relationship.trust + 2, affection: before.relationship.affection + 1,
    resentment: before.relationship.resentment - 1, comfort: before.relationship.comfort + 1 });
  expect(paid.relationshipRepair.lastRepairSource).toMatchObject({ sequence: 3 });
  f.commit(e); f.runtime.observed(e, f.now()); expect(f.character.getState()).toEqual(paid);
  vi.advanceTimersByTime(30000); const next = f.complete(4); const ordinary = f.character.getState();
  expect(ordinary.relationship.trust).toBe(paid.relationship.trust + 1); f.commit(next);
  expect(f.character.getState()).toEqual(ordinary);
});
it.each([199, 200, 201])('accepts only an acknowledgement strictly before the %ims boundary', delay => {
  const f = fixture(); f.interrupt(); vi.advanceTimersByTime(300000); const e = f.complete();
  vi.advanceTimersByTime(delay); f.commit(e);
  expect(f.character.getState().relationship).toMatchObject({ trust: delay < 200 ? 502 : 501, resentment: delay < 200 ? 2 : 3 });
  expect(f.character.getState().relationshipRepair.lastRepairAt === null).toBe(delay >= 200);
});
it.each(['source-mutation', 'interruption', 'offline', 'dispose', 'replacement', 'full-reset'] as const)('settles %s with no late repair', mode => {
  const f = fixture(); f.interrupt(); vi.advanceTimersByTime(300000); const e = f.complete();
  if (mode === 'source-mutation') f.invalidate();
  if (mode === 'interruption') { const newer = f.event(4, 'user_interrupted'); f.runtime.observed(newer, f.now()); }
  if (mode === 'offline') { f.offline(); vi.advanceTimersByTime(200); }
  if (mode === 'dispose') f.runtime.dispose();
  if (mode === 'replacement') f.character.replaceRestoredState(f.character.createDefaults());
  if (mode === 'full-reset') f.reset();
  f.commit(e); vi.advanceTimersByTime(200);
  expect(f.character.getState().relationship.trust).toBe(['replacement', 'full-reset'].includes(mode) ? 500 : 501);
  expect(f.character.getState().relationshipRepair.lastRepairAt).toBeNull();
});
it('validates exact persisted interruption proof within the shared barrier/read deadline without replay', async () => {
  const f = fixture(); const interruption = f.interrupt(); f.runtime.invalidate();
  const before = f.character.getState();
  vi.mocked(f.repository.resolveSources).mockResolvedValue({ ok: true, value: [interruption] });
  await f.runtime.revalidate(); expect(f.character.getState()).toEqual(before);
  vi.advanceTimersByTime(300000); const e = f.complete(); f.commit(e);
  expect(f.character.getState().relationship.resentment).toBe(2);
});
it('does not publish a late proof after destructive invalidation or a 200ms pending append wait', async () => {
  const f = fixture(); f.interrupt();
  const source = f.character.getState().relationshipRepair;
  let settle: (() => void) | undefined;
  f.barrier.snapshot = () => ({ generation: 0, revision: 1, pending: true });
  f.barrier.whenSettled = () => new Promise(resolve => { settle = resolve; });
  const pending = f.runtime.revalidate(); vi.advanceTimersByTime(200); await pending;
  settle?.(); await flush(); expect(f.repository.resolveSources).not.toHaveBeenCalled();
  expect(f.character.getState().relationshipRepair).toEqual(source);
  vi.advanceTimersByTime(300000); const e = f.complete(); f.commit(e);
  expect(f.character.getState().relationship).toMatchObject({ trust: 501, resentment: 3 });
});
it('quarantines backwards wall time until a fresh acknowledged interruption replaces the proof', () => {
  const f = fixture(); f.interrupt(); vi.advanceTimersByTime(300000);
  const e = f.complete(); f.commit(e);
  const paid = f.character.getState();
  f.setWallOffset(-329000); f.character.restoreRelationshipRepair(base + 330000);
  expect(f.character.getState()).toEqual(paid);
  vi.advanceTimersByTime(30000); const interruption = f.event(4, 'user_interrupted'); f.runtime.observed(interruption, f.now()); f.commit(interruption);
  expect(f.character.getState().relationshipRepair.lastRepairAt).toBeNull();
  vi.advanceTimersByTime(300000); const newGame = f.complete(5); f.commit(newGame);
  expect(f.character.getState().relationship.resentment).toBeLessThanOrEqual(1);
});
it.each([198, 199])('preserves the actual effect cooldown across restart at source+5min+%ims', async offset => {
  const f = fixture(); const interruption = f.interrupt(); vi.advanceTimersByTime(300000);
  const first = f.complete(); vi.advanceTimersByTime(199); f.commit(first);
  const snapshot = projectCharacterMemory(f.character.getState(), new Date().toISOString());
  expect(snapshot.state.relationshipRepair.lastRepairAt).toBe(new Date(base + 330199).toISOString());
  f.runtime.dispose(); vi.advanceTimersByTime(1000);
  const restartWall = Date.now(), mono = () => Date.now() - restartWall;
  const character = new CharacterStateService({ now: Date.now, monotonicNow: mono });
  character.replaceRestoredState(restoreCharacterMemory(snapshot, character.createDefaults(), Date.now()));
  character.restoreRelationshipRepair(Date.parse(snapshot.updatedAt));
  vi.mocked(f.repository.resolveSources).mockResolvedValue({ ok: true, value: [interruption] });
  const restarted = new RelationshipRepairRuntime({ ...f.options, character, now: mono, appRunId: () => 'restarted' });
  await restarted.revalidate();
  vi.advanceTimersByTime(base + 630000 + offset - Date.now());
  const second = { ...first, appRunId: 'restarted', sequence: 1, activityRunId: 'fresh-game', occurredAt: new Date().toISOString() };
  restarted.observed(second, mono()); restarted.committed(second, { generation: 0 }, mono());
  expect(character.getState().relationship).toMatchObject({ trust: offset === 198 ? 503 : 504, resentment: offset === 198 ? 2 : 1 });
  restarted.dispose();
});
