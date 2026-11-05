import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';
function fixture() {
  let f: ReturnType<typeof scenario>;
  f = scenario({ energy: 70, boredom: 70, play: 0, attention: 0, comfort: 60 }, .2, undefined, undefined, {
    ownHabit: {
      started: (run, activity, sequence, at) => f.character.ownHabitStarted('app', run, activity, sequence, at),
      pose: (run, pose) => f.character.ownHabitPose(run, pose),
      finished: (run, done, at) => f.character.ownHabitFinished('app', run, done, at),
      multiplier: at => f.character.getOwnHabitMultiplier(at), interrupt: () => f.character.interruptOwnHabit(), invalidate: () => f.character.invalidateOwnHabit(),
    },
  });
  // The real Character owns a monotonic startup gate; use restored historical samples for selection.
  const s = f.character.getState();
  f.character.replaceRestoredState({ ...s, ownHabitMemory: { lastLearnedAt: '1970-01-01T00:00:00.000Z',
    transitions: Array.from({ length: 6 }, (_, i) => ({ appRunId: 'prior', exploreRunId: `e${i}`, nextRunId: `c${i}`,
      nextKind: 'calm_look_around', completedAt: '1970-01-01T00:00:00.000Z' })) } });
  return f;
}
it('enables the learned factor only after a real completed Explore and consumes the cue on actual next start', () => {
  const f = fixture(); expect(f.character.getOwnHabitMultiplier(f.now())).toBe(1);
  f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('explore');
  expect(f.character.getOwnHabitMultiplier(f.now())).toBe(1); f.finish();
  expect(f.character.getOwnHabitMultiplier(f.now())).toBeCloseTo(1.1);
  // The completed Explore changes Needs and repetition; this draw remains in its next weighted bucket.
  f.setRandom(.4); f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('explore');
  expect(f.character.getOwnHabitMultiplier(f.now())).toBe(1);
  f.main.dispose();
});
it.each(['input', 'quiet', 'menu', 'forced', 'stop'] as const)('clears a fresh cue on %s without erasing intrinsic samples', kind => {
  const f = fixture(); f.pulse(); f.finish(); expect(f.character.getOwnHabitMultiplier(f.now())).toBeCloseTo(1.1);
  if (kind === 'input') f.main.acceptUserContact();
  if (kind === 'quiet') f.main.setQuietMode(true);
  if (kind === 'menu') f.main.setMenuOpen(true);
  if (kind === 'forced') f.main.beginDrag();
  if (kind === 'stop') f.main.stop();
  expect(f.character.getOwnHabitMultiplier(f.now())).toBe(1);
  expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(6);
  f.main.dispose();
});

it('binds the actual calm pose before presentation and appends only after its real completed terminal', () => {
  const f = fixture(); f.elapse(310000); f.pulse(); f.finish();
  f.character.applyStimulus({ type: 'play', source: 'system' });
  f.setRandom(.2); f.pulse();
  expect(f.main.getActivityTimeline()?.activityId).toBe('calm');
  expect(f.main.getVisualEpisode().intent.kind).toBe('look_around');
  expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(6);
  f.finish();
  expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(7);
  expect(f.character.getState().ownHabitMemory.transitions.at(-1)?.nextKind).toBe('calm_look_around');
  f.main.dispose();
});
it('accepts a fresh cue from an actual provider Explore without treating the provider reply as a sample', () => {
  const f = fixture(); f.elapse(10000); f.offer('wander');
  expect(f.main.getActivityTimeline()?.activityId).toBe('explore'); f.finish();
  expect(f.character.getOwnHabitMultiplier(f.now())).toBeCloseTo(1.1);
  expect(f.character.getState().ownHabitMemory.transitions).toHaveLength(6);
  f.main.dispose();
});
