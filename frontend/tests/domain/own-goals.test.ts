import { expect, it } from 'vitest';
import { activeOwnGoal, cancelOwnGoals, evaluateOwnGoals, finishOwnGoal, initialMotivation, ownGoalMultiplier } from '../../src/domain/character/own-goals';

const start = '2026-11-05T10:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(start) + ms).toISOString();
function ids() { let next = 0; return () => `goal-${++next}`; }
it('keeps at most one finite goal per kind until the deficit really rearms', () => {
  const createId = ids();
  let state = evaluateOwnGoals(initialMotivation(start), { energy: 35, boredom: 65 }, start, createId);
  expect(state.goals.map(g => [g.kind, g.id])).toEqual([['recover_energy', 'goal-1'], ['seek_novelty', 'goal-2']]);
  for (let n = 1; n <= 20; n++) state = evaluateOwnGoals(state, { energy: 35, boredom: 65 }, at(n * 1000), createId);
  expect(state.goals.map(g => g.id)).toEqual(['goal-1', 'goal-2']);
  state = evaluateOwnGoals(state, { energy: 35, boredom: 65 }, at(600000), createId);
  expect(state.goals.map(g => g.status)).toEqual(['expired', 'expired']);
  state = evaluateOwnGoals(state, { energy: 35, boredom: 65 }, at(610000), createId);
  expect(state.goals.map(g => g.id)).toEqual(['goal-1', 'goal-2']);
  state = evaluateOwnGoals(state, { energy: 60, boredom: 39 }, at(620000), createId);
  state = evaluateOwnGoals(state, { energy: 35, boredom: 65 }, at(630000), createId);
  expect(state.goals.map(g => g.id)).toEqual(['goal-3', 'goal-4']);
});
it('uses exact thresholds and gives invalid or absent Needs no invented motivation', () => {
  const empty = initialMotivation(start), createId = ids();
  expect(evaluateOwnGoals(empty, { energy: 40, boredom: 59.999 }, start, createId).goals).toEqual([]);
  expect(evaluateOwnGoals(empty, { energy: 30, boredom: 60 }, start, createId).goals.map(g => g.kind)).toEqual(['recover_energy', 'seek_novelty']);
  expect(evaluateOwnGoals(empty, { energy: 29.999, boredom: 60 }, start, createId).goals.map(g => g.kind)).toEqual(['recover_energy']);
  for (const needs of [{ energy: NaN, boredom: 70 }, { energy: 50, boredom: Infinity }, { energy: 50 }, { energy: -1, boredom: 70 }]) {
    expect(evaluateOwnGoals(empty, needs, start, createId).goals).toEqual([]);
  }
  expect(evaluateOwnGoals(empty, { energy: 35, boredom: 65 }, 'invalid', createId)).toBe(empty);
});
it('changes only the appropriate optional factor and never makes a blocked action mandatory', () => {
  const state = evaluateOwnGoals(initialMotivation(start), { energy: 35, boredom: 65 }, start, ids());
  expect(activeOwnGoal(state, { energy: 35, boredom: 65 }, start)?.kind).toBe('recover_energy');
  expect(ownGoalMultiplier(state, { energy: 35, boredom: 65 }, start, 'sleep', true)).toBe(1.2);
  expect(ownGoalMultiplier(state, { energy: 35, boredom: 65 }, start, 'wander', true)).toBe(1);
  expect(activeOwnGoal(state, { energy: 45, boredom: 65 }, start)?.kind).toBe('seek_novelty');
  expect(ownGoalMultiplier(state, { energy: 45, boredom: 65 }, start, 'wander', true)).toBe(1.2);
  expect(ownGoalMultiplier(state, { energy: 45, boredom: 65 }, start, 'wander', false)).toBe(1);
  expect(ownGoalMultiplier(state, { energy: 45, boredom: 65 }, at(600000), 'wander', true)).toBe(1);
});
it('expires before completion, accepts only a matching goal, and never rewards a rejected attempt', () => {
  const state = evaluateOwnGoals(initialMotivation(start), { energy: 50, boredom: 65 }, start, ids());
  const goal = state.goals[0]!;
  expect(finishOwnGoal(state, 'unrelated', 'completed', start).goals[0]?.status).toBe('pending');
  const finished = finishOwnGoal(state, goal.id, 'completed', at(1000));
  expect(finished.goals[0]?.status).toBe('completed');
  expect(finishOwnGoal(finished, goal.id, 'completed', at(1000))).toBe(finished);
  expect(finishOwnGoal(state, goal.id, 'failed', at(1000)).goals[0]?.status).toBe('cancelled');
  expect(finishOwnGoal(state, goal.id, 'completed', at(600000)).goals[0]?.status).toBe('expired');
});
it('cancels on backward time or explicit command without rearming the same sustained deficit', () => {
  const createId = ids(), state = evaluateOwnGoals(initialMotivation(start), { energy: 35, boredom: 65 }, start, createId);
  const cancelled = cancelOwnGoals(state, at(1000));
  expect(evaluateOwnGoals(cancelled, { energy: 35, boredom: 65 }, at(2000), createId).goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
  const backwards = evaluateOwnGoals(state, { energy: 35, boredom: 65 }, at(-1), createId);
  expect(backwards.goals.map(g => g.status)).toEqual(['cancelled', 'cancelled']);
  expect(ownGoalMultiplier(backwards, { energy: 35, boredom: 65 }, at(-1), 'sleep', true)).toBe(1);
  expect(evaluateOwnGoals(backwards, { energy: 35, boredom: 65 }, at(1000), createId).goals.map(g => g.id)).toEqual(['goal-1', 'goal-2']);
});
