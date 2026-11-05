import { afterEach, expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { OwnGameInterestRuntime } from '../../src/application/services/own-game-interest-runtime';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import type { CausalLifeEpisode, ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import type { CausalSourceReference } from '../../src/domain/character/types';

const refs = (offset: number): readonly CausalSourceReference[] => Array.from({ length: 6 }, (_, i) => ({ appRunId: 'app', sequence: offset + i, revision: 1 }));
function episode(ref: CausalSourceReference, book: boolean): CausalLifeEpisode {
  return { ...ref, occurredAt: '2026-11-06T12:00:00.000Z', source: 'autonomy', triggerSequence: null, terminalReason: null,
    activityRunId: `run-${ref.sequence}`, activity: book ? 'book' : 'cursor_game', outcome: 'completed', cause: 'completed',
    participation: book ? 'solitary' : 'user_engaged', executedMs: book ? 14_000 : 1000 };
}
afterEach(() => vi.useRealTimers());
it('resolves both exact groups in parallel within one 200ms budget and neutralizes only the timed-out group', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const character = new CharacterStateService({ now: Date.now, monotonicNow: Date.now }), original = character.getState();
  const track = { value: 100, samples: 6, confidence: .5 };
  character.replaceRestoredState({ ...original, ownBookInterestSources: refs(101), ownGameInterestSources: refs(1),
    preferences: { 'own.activity.book': track, 'own.activity.cursor_game': track } });
  let releaseGame: (() => void) | undefined;
  const repository: ICausalLifeRepository = { append: vi.fn(), getRecent: vi.fn(), resolveSources: vi.fn<ICausalLifeRepository['resolveSources']>(async sources => {
    const book = sources[0]?.sequence === 101;
    if (!book) await new Promise<void>(resolve => { releaseGame = resolve; });
    return { ok: true, value: sources.map(ref => episode(ref, book)) };
  }) };
  const runtime = new OwnGameInterestRuntime({ character, repository, context: () => ({ generation: 0 }),
    appRunId: () => 'app', now: Date.now, scheduler: { setTimeout, clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) } });
  const pending = runtime.revalidate();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(repository.resolveSources).toHaveBeenCalledTimes(2);
  expect(vi.mocked(repository.resolveSources).mock.calls.map(([sources]) => sources.length)).toEqual([6, 6]);
  expect(character.getOwnBookInterest().band).toBe('emerging'); expect(character.getOwnGameInterest().band).toBe('none');
  await vi.advanceTimersByTimeAsync(200); await pending;
  expect(character.getOwnBookInterest().multiplier).toBe(1.2); expect(character.getOwnGameInterest().multiplier).toBe(1);
  releaseGame?.(); await Promise.resolve(); expect(character.getOwnGameInterest().band).toBe('none');
  runtime.invalidate(); expect(character.getOwnBookInterest().band).toBe('none');
  expect(character.getState().preferences['own.activity.book']).toEqual(track); runtime.dispose();
});
it('migrates V5 without book backfill while preserving repair, habit and existing activity preferences', () => {
  const character = new CharacterStateService(), original = character.getState();
  original.preferences['activity.explore'] = { value: 2, samples: 2, confidence: .25 };
  original.preferences['own.activity.book'] = { value: 100, samples: 100, confidence: 1 };
  const projected = projectCharacterMemory({ ...original, ownBookInterestSources: refs(101), ownGameInterestSources: refs(1) }, '2026-11-06T12:00:00.000Z');
  expect(projected.snapshotVersion).toBe(6);
  const restored = restoreCharacterMemory(projected, character.createDefaults(), 10);
  expect(restored.ownBookInterestSources).toEqual(refs(101));
  const { ownBookInterestSources: _book, ...oldState } = projected.state;
  const legacy = restoreCharacterMemory({ ...projected, snapshotVersion: 5, state: oldState }, character.createDefaults(), 10);
  expect(legacy.ownBookInterestSources).toEqual([]); expect(legacy.preferences).not.toHaveProperty('own.activity.book');
  expect(legacy.preferences['activity.explore']).toEqual(original.preferences['activity.explore']);
  expect(legacy.ownGameInterestSources).toEqual(refs(1)); expect(legacy.relationshipRepair).toEqual(original.relationshipRepair);
  expect(legacy.ownHabitMemory).toEqual(original.ownHabitMemory);
  expect(() => restoreCharacterMemory({ ...projected, state: { ...projected.state, ownBookInterestSources: Array.from({ length: 21 }, (_, i) => ({ appRunId: 'app', sequence: i + 1, revision: 1 })) } }, character.createDefaults(), 10)).toThrow();
});
