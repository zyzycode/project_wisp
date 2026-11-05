import { expect, it } from 'vitest';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
const snapshot = { needs: { energy: 70, attention: 0, play: 0, comfort: 60, boredom: 20 }, synthesizedTone: 'neutral' as const };
const context = { nowMs: 1000, canExplore: true, canPlay: true, canRest: true, history: [] };
it('uses the same family draw and the exact final pose, with only its family modifier', () => {
  const before = selectLocalActivity(snapshot, context, 0);
  const after = selectLocalActivity(snapshot, { ...context, ownGoal: 'seek_novelty', ownPlanStep: 'calm_look_around' }, 0);
  expect(before.intent).toMatchObject({ kind: 'idle', calmPose: 'idle_blink' });
  expect(after.intent).toMatchObject({ kind: 'idle', calmPose: 'look_around' });
  const row = after.trace.find(candidate => candidate.kind === 'idle')!;
  expect(row.planMultiplier).toBe(1.2); expect(row.goalMultiplier).toBe(1);
  expect(row.score / row.baselineScore).toBeCloseTo(1.2);
  expect(after.trace.filter(candidate => candidate.selected)).toHaveLength(1);
});
it('omits a final-pose plan modifier when the existing pose weight is invalid', () => {
  const result = selectLocalActivity(snapshot, { ...context, ownPlanStep: 'calm_look_around',
    history: [{ kind: 'calm:look_around', atMs: NaN }] }, 0);
  expect(result.trace.find(row => row.kind === 'idle')?.planMultiplier).toBe(1);
});
it('leaves unrelated Utility winners free while the next plan step replaces its goal factor', () => {
  const result = selectLocalActivity({ ...snapshot, needs: { ...snapshot.needs, boredom: 70 } },
    { ...context, ownGoal: 'seek_novelty', ownPlanStep: 'explore' }, 0);
  const explore = result.trace.find(row => row.kind === 'wander')!;
  expect(explore.goalMultiplier).toBe(1); expect(explore.planMultiplier).toBe(1.2);
  expect(explore.score / explore.baselineScore).toBeCloseTo(1.2);
  const recovery = selectLocalActivity(snapshot, { ...context, ownGoal: 'recover_energy', ownPlanStep: 'explore' }, 0);
  expect(recovery.trace.every(row => row.goalMultiplier === 1)).toBe(true);
});
