import { expect, it } from 'vitest';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
const snapshot = { needs: { energy: 70, attention: 0, play: 0, comfort: 60, boredom: 20 }, synthesizedTone: 'neutral' as const };
const context = { nowMs: 1000, canExplore: true, canPlay: true, canRest: true, history: [] };
it('biases only the pose within the same calm bucket, preserving family scores and the single draw', () => {
  let changed = 0;
  for (let i = 0; i < 1000; i++) {
    const base = selectLocalActivity(snapshot, context, i / 1000), learned = selectLocalActivity(snapshot, { ...context, ownHabitMultiplier: 1.1 }, i / 1000);
    expect(learned.intent.kind).toBe(base.intent.kind);
    expect(learned.trace.map(row => row.score)).toEqual(base.trace.map(row => row.score));
    if (learned.intent.calmPose !== base.intent.calmPose) { expect(learned.intent.calmPose).toBe('look_around'); changed++; }
  }
  expect(changed).toBeGreaterThan(0);
});
it('caps the effective pose factor against family goal/plan and coping while exact plan pose bypasses habit', () => {
  const cue = selectLocalActivity(snapshot, { ...context, ownHabitMultiplier: 1.1, copingStrategy: 'pause' }, 0);
  expect(cue.trace.find(row => row.kind === 'idle')?.habitMultiplier).toBe(1.1);
  const exact = selectLocalActivity(snapshot, { ...context, ownHabitMultiplier: 1.1, ownPlanStep: 'calm_look_around', copingStrategy: 'pause' }, 0);
  expect(exact.intent.calmPose).toBe('look_around'); expect(exact.trace.find(row => row.kind === 'idle')?.habitMultiplier).toBe(1);
  expect(exact.trace.find(row => row.kind === 'idle')!.score / exact.trace.find(row => row.kind === 'idle')!.baselineScore).toBeCloseTo(1.44);
});
it.each([undefined, 1, NaN, Infinity, 1.11, .9])('is neutral for absent or invalid habit factor %s', ownHabitMultiplier => {
  const before = selectLocalActivity(snapshot, context, .3);
  expect(selectLocalActivity(snapshot, { ...context, ownHabitMultiplier }, .3)).toEqual(before);
});
