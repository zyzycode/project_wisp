import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
const base = Date.parse('2026-11-05T10:00:00.000Z');
function fixture() {
  let now = 0, sequence = 0;
  const character = new CharacterStateService({ now: () => base + now, monotonicNow: () => now });
  const next = (kind: string, pose = 'look_around') => {
    const run = `${++sequence}:run`; character.ownHabitStarted('app', run, kind, sequence, now);
    character.ownHabitPose(run, pose); now += 1000; character.ownHabitFinished('app', run, true, now); return run;
  };
  return { character, next, advance: (ms: number) => { now += ms; }, now: () => now };
}
it('keeps habit samples separate from axes/tastes and preserves evidence across V5 restore without a cue', () => {
  const f = fixture(), initial = f.character.getState(); f.advance(300000);
  for (let i = 0; i < 6; i++) { f.next('explore'); f.next('calm'); f.advance(300000); }
  const learned = f.character.getState();
  expect(learned.ownHabitMemory.transitions).toHaveLength(6);
  expect(learned.preferences).toEqual(initial.preferences); expect(learned.personality).toEqual(initial.personality);
  expect(learned.needs).toEqual(initial.needs); expect(learned.relationship).toEqual(initial.relationship);
  f.next('explore'); expect(f.character.getOwnHabitMultiplier()).toBeCloseTo(1.1);
  const snapshot = projectCharacterMemory(f.character.getState(), new Date(base + f.now()).toISOString());
  const restored = restoreCharacterMemory(snapshot, f.character.createDefaults(), base + f.now());
  f.character.replaceRestoredState(restored); expect(f.character.getOwnHabitMultiplier()).toBe(1);
  f.next('explore'); const before = f.character.getState().ownHabitMemory;
  f.next('calm'); expect(f.character.getState().ownHabitMemory).toEqual(before);
  f.character.resetToDefaults(); expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(0);
  f.character.ownHabitFinished('app', 'late-run', true, f.now());
  expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(0);
});
