import { expect, it } from 'vitest';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';
const snapshot = { needs: { energy: 50, attention: 90, play: 20, comfort: 50, boredom: 40 },
  synthesizedTone: 'neutral' as const, relationship: { friendship: 500 } };
const context = { nowMs: 1000, canExplore: true, canPlay: true, canRest: true, canSocial: true, history: [] };
it.each(['pause', 'explore'] as const)('applies %s before pool cutoff and leaves other families unchanged', strategy => {
  const before = selectLocalActivity(snapshot, context, .4);
  const after = selectLocalActivity(snapshot, { ...context, copingStrategy: strategy }, .4);
  for (const row of after.trace) {
    const base = before.trace.find(candidate => candidate.kind === row.kind)!;
    const factor = row.kind === (strategy === 'pause' ? 'idle' : 'wander') ? 1.2 : 1;
    expect(row.copingMultiplier).toBe(factor);
    expect(row.score).toBeCloseTo(base.score * factor);
    expect(row.poolEligible).toBe(row.score >= .5 * Math.max(...after.trace.map(candidate => candidate.score)));
  }
});
it('caps coping and the winning plan modifier together while the plan replaces its goal modifier', () => {
  const result = selectLocalActivity(snapshot, { ...context, ownGoal: 'seek_novelty', ownPlanStep: 'explore', copingStrategy: 'explore' }, 0);
  const calm = result.trace.find(row => row.kind === 'wander')!;
  expect(calm.goalMultiplier).toBe(1);
  expect(calm.planMultiplier).toBeGreaterThan(1);
  expect(calm.copingMultiplier).toBe(1.2);
  expect(calm.score / calm.baselineScore).toBeCloseTo(1.44);
  expect(calm.score / calm.baselineScore).toBeLessThanOrEqual(1.5);
});
