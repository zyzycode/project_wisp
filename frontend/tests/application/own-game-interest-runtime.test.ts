import { afterEach, expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { OwnGameInterestRuntime } from '../../src/application/services/own-game-interest-runtime';
import { CausalLifeRecorder } from '../../src/application/services/causal-life-recorder';
import type { CausalLifeEpisode, ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';
import { resolveCursorObserve, type CursorObserveInput } from '../../src/domain/behavior/cursor-observe-policy';
import { OWN_GAME_INTEREST_KEY } from '../../src/domain/character/own-game-interest';
const episode = (sequence: number): CausalLifeEpisode => ({ appRunId: 'app', sequence, revision: 1, occurredAt: '2026-11-01T00:00:00.000Z', source: 'autonomy', triggerSequence: null, activity: 'cursor_game', activityRunId: `run${sequence}`, outcome: 'completed', cause: 'completed', terminalReason: null, executedMs: 1500, participation: 'user_engaged' });
function fixture() {
  let now = 0, generation = 0;
  const character = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  const sources = new Map<number, CausalLifeEpisode>();
  const repository: ICausalLifeRepository = { append: vi.fn<ICausalLifeRepository['append']>(async () => ({ ok: true, value: undefined })), getRecent: vi.fn(), resolveSources: vi.fn<ICausalLifeRepository['resolveSources']>(async refs => ({ ok: true, value: refs.flatMap(ref => sources.get(ref.sequence) ?? []) })) };
  const scheduler = { setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms), clearTimeout: (handle: unknown) => { if (typeof handle === 'number' || (typeof handle === 'object' && handle !== null && 'hasRef' in handle)) clearTimeout(handle as ReturnType<typeof setTimeout>); } };
  const runtime = new OwnGameInterestRuntime({ character, repository, scheduler, now: () => Date.now(), context: () => ({ generation }) });
  const learn = async (count = 6) => { for (let i = 1; i <= count; i++) { now = i * 300000; const e = episode(i); sources.set(i, e); runtime.committed(e, { generation }, now); await runtime.revalidate(); } };
  return { character, repository, runtime, sources, learn, setNow: (value: number) => { now = value; }, reset: () => { generation++; runtime.invalidate(); character.resetToDefaults(); } };
}
afterEach(() => { vi.useRealTimers(); });
it('learns only from live committed callbacks, independently of user tastes, and validates reflection references', async () => {
  const f = fixture(); await f.learn();
  expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]).toEqual({ value: 6, samples: 6, confidence: .5 });
  expect(f.character.getState().preferences['activity.cursor_game']).toBeUndefined();
  expect(f.character.getOwnGameInterest()).toMatchObject({ band: 'emerging', multiplier: 1.012, sources: Array.from({ length: 6 }, (_, i) => ({ appRunId: 'app', sequence: i + 1, revision: 1 })) });
  const before = f.character.getState(); await f.runtime.revalidate(); await f.runtime.revalidate();
  f.runtime.committed(episode(1), { generation: 0 }, 99999999); expect(f.character.getState()).toEqual(before);
  f.sources.delete(1); f.runtime.invalidate(); expect(f.character.getOwnGameInterest().band).toBe('none');
  await f.runtime.revalidate(); expect(f.character.getState().ownGameInterestSources).toHaveLength(5);
  expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]).toEqual(before.preferences[OWN_GAME_INTEREST_KEY]);
  expect(f.character.getOwnGameInterest().multiplier).toBe(1);
});
it('restore preserves V3 taste but needs indexed proof and a full fresh learning window, without replay', async () => {
  const f = fixture(); await f.learn(); const checkpoint = projectCharacterMemory(f.character.getState(), '2026-11-01T00:00:00.000Z');
  const restored = restoreCharacterMemory(checkpoint, f.character.createDefaults(), 0); f.setNow(0); f.character.replaceRestoredState(restored);
  expect(f.character.getOwnGameInterest().band).toBe('none'); await f.runtime.revalidate(); expect(f.character.getOwnGameInterest().band).toBe('emerging');
  const next = episode(7); f.sources.set(7, next); f.runtime.committed(next, { generation: 0 }, 1); await f.runtime.revalidate();
  expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]?.samples).toBe(6);
  f.runtime.committed(next, { generation: 0 }, 300000); expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]?.samples).toBe(6);
  f.runtime.committed(episode(8), { generation: 0 }, 300000); await f.runtime.revalidate(); expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]?.samples).toBe(7);
});
it('timeout, reset, unavailable sources and disposal cannot restore late source proof or learning', async () => {
  vi.useFakeTimers(); const f = fixture(); await f.learn();
  let finish: ((value: Awaited<ReturnType<ICausalLifeRepository['resolveSources']>>) => void) | undefined;
  vi.mocked(f.repository.resolveSources).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.runtime.revalidate(); await Promise.resolve();
  expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(200); await pending;
  expect(f.character.getOwnGameInterest().band).toBe('none'); finish?.({ ok: true, value: Array.from(f.sources.values()) }); await Promise.resolve();
  expect(f.character.getOwnGameInterest().band).toBe('none');
  const afterReset = f.runtime.revalidate(); await Promise.resolve(); f.reset(); await vi.advanceTimersByTimeAsync(200); await afterReset;
  finish?.({ ok: true, value: Array.from(f.sources.values()) }); await Promise.resolve();
  expect(f.character.getState().ownGameInterestSources).toEqual([]);
  f.runtime.committed(episode(100), { generation: 0 }, 99999999); expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]).toBeUndefined();
  const afterDispose = f.runtime.revalidate(); f.runtime.dispose(); await afterDispose; expect(vi.getTimerCount()).toBe(0);
});
it('paired confirmed histories change only the eligible cursor opportunity and temporary satiation preserves taste', async () => {
  const f = fixture(); await f.learn(); const cold = new CharacterStateService({ now: () => 0, monotonicNow: () => 0 });
  const input: CursorObserveInput = { nowMs: 0, signal: { cursor: { globalPosition: { x: 30, y: 0 }, capturedAtMs: 0 }, distanceToRootWorldPx: 30, withinAttentionRange: true, withinSwatRange: true, dwellWithinSwatRangeMs: 500, emittedAtMs: 0 }, needs: cold.getState().needs, tone: 'neutral', friendship: 0, noticeRandomUnit: 0, gameCandidateEligible: true };
  const warmSnapshot = createCharacterAutonomySnapshot(f.character.getState(), 0, null, f.character.getOwnGameInterest().multiplier);
  const baseline = resolveCursorObserve(input), warm = resolveCursorObserve({ ...input, ownGameInterestMultiplier: warmSnapshot.ownGameInterestMultiplier });
  const draw = (baseline.noticeChance + warm.noticeChance) / 2;
  expect(resolveCursorObserve({ ...input, noticeRandomUnit: draw }).noticed).toBe(false);
  expect(resolveCursorObserve({ ...input, noticeRandomUnit: draw, ownGameInterestMultiplier: warmSnapshot.ownGameInterestMultiplier }).noticed).toBe(true);
  expect(resolveCursorObserve({ ...input, gameCandidateEligible: false, ownGameInterestMultiplier: 1.2 })).toEqual(resolveCursorObserve({ ...input, gameCandidateEligible: false }));
  expect(resolveCursorObserve({ ...input, ownGameInterestMultiplier: 1.2, cursorGameSatiation: 1 }).noticeChance).toBeLessThan(baseline.noticeChance);
  expect(f.character.getState().preferences[OWN_GAME_INTEREST_KEY]?.value).toBe(6);
});
it('the recorder never teaches failed writes, reset/disposed callbacks or equivalent game-history reads', async () => {
  const f = fixture(); let generation = 0, appRunId = 'app';
  const commits = vi.fn(); let complete: ((value: Awaited<ReturnType<ICausalLifeRepository['append']>>) => void) | undefined;
  vi.mocked(f.repository.append).mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  const recorder = new CausalLifeRecorder({ repository: f.repository, generation: () => generation, appRunId: () => appRunId, context: () => ({ generation }), toTimestamp: at => new Date(at).toISOString(), onFailure: vi.fn(), commitObserver: { committed: commits } });
  const terminal = { type: 'activity_outcome', eventId: 'terminal1', activity: 'cursor_game', activityRunId: 'run1', activitySequence: 1, atMs: 300000, family: 'cursor_interest', outcome: 'completed', terminalReason: null, executedMs: 1500, participation: 'user_engaged', playCompleted: true } as const;
  recorder.outcome(terminal); complete?.({ ok: false, code: 'unavailable' }); await Promise.resolve(); expect(commits).not.toHaveBeenCalled();
  recorder.outcome({ ...terminal, activityRunId: 'run2', activitySequence: 2 }); generation++; appRunId = 'new'; recorder.reset(); complete?.({ ok: true, value: undefined }); await Promise.resolve(); expect(commits).not.toHaveBeenCalled();
  recorder.outcome({ ...terminal, activityRunId: 'run3', activitySequence: 3 }); recorder.dispose(); complete?.({ ok: true, value: undefined }); await Promise.resolve(); expect(commits).not.toHaveBeenCalled();
});

it('coalesces rapid invalidation and newer accepted sources into one latest proof read without stale publication', async () => {
  const f = fixture(); await f.learn();
  let finish: ((value: Awaited<ReturnType<ICausalLifeRepository['resolveSources']>>) => void) | undefined;
  const resolveSources = vi.mocked(f.repository.resolveSources);
  resolveSources.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const before = resolveSources.mock.calls.length;
  const first = f.runtime.revalidate(); await Promise.resolve();
  f.runtime.invalidate();
  const latest = f.runtime.revalidate();
  f.sources.set(7, episode(7)); f.runtime.committed(episode(7), { generation: 0 }, 2100000);
  f.runtime.revalidate(); f.runtime.revalidate();
  expect(resolveSources.mock.calls.length).toBe(before + 1);
  finish?.({ ok: true, value: Array.from(f.sources.values()).slice(0, 6) });
  await first; await latest;
  expect(resolveSources.mock.calls.length).toBe(before + 2);
  expect(resolveSources.mock.lastCall?.[0]).toHaveLength(7);
  expect(f.character.getOwnGameInterest()).toMatchObject({ band: 'emerging', sources: expect.arrayContaining([{ appRunId: 'app', sequence: 7, revision: 1 }]) });
});
