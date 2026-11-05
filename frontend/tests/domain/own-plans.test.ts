import { expect, it } from 'vitest';
import { evaluateOwnGoals, initialMotivation } from '../../src/domain/character/own-goals';
import { claimOwnPlan, finishOwnPlan, prepareOwnPlan, restoreOwnPlan, selectedOwnPlanStep } from '../../src/domain/character/own-plans';

const now = '2026-11-05T10:00:00.000Z';
const needs = { energy: 35, boredom: 70 };
function plan() { return prepareOwnPlan(evaluateOwnGoals(initialMotivation(now), needs, now, kind => kind), needs, now); }
it('advances three distinct semantic runs only from exact live claim/terminal proof and pays no separate effects', () => {
  let record = plan();
  expect(record.plan?.steps).toEqual(['rest', 'explore', 'calm_look_around']);
  for (const [index, step] of ['rest', 'explore', 'calm_look_around'].entries()) {
    expect(selectedOwnPlanStep(record, needs, now)).toBe(step);
    const token = `token-${index}`;
    const claimed = claimOwnPlan(record, needs, now, 'app', token)!;
    expect(selectedOwnPlanStep(claimed, needs, now)).toBeNull();
    expect(finishOwnPlan(claimed, now, { appRunId: 'other', stepToken: token, runId: `run-${index}`, result: 'completed' })).toBe(claimed);
    record = finishOwnPlan(claimed, now, { appRunId: 'app', stepToken: token, runId: `run-${index}`, result: 'completed' });
    expect(finishOwnPlan(record, now, { appRunId: 'app', stepToken: token, runId: `run-${index}`, result: 'completed' })).toBe(record);
    expect(record.goals.find(g => g.kind === 'recover_energy')?.status).toBe('completed');
    expect(record.goals.find(g => g.kind === 'seek_novelty')?.status).toBe(index === 2 ? 'completed' : 'pending');
  }
  expect(record.plan).toBeNull();
});
it('pauses for a low fresh Need, cancels obsolete novelty before Explore, but still requires final calm after Explore', () => {
  let record = prepareOwnPlan(evaluateOwnGoals(initialMotivation(now), { energy: 70, boredom: 70 }, now, kind => kind), { energy: 70, boredom: 70 }, now);
  expect(selectedOwnPlanStep(record, { energy: 29, boredom: 70 }, now)).toBeNull();
  expect(prepareOwnPlan(record, { energy: 70, boredom: 39 }, now).plan).toBeNull();
  record = finishOwnPlan(claimOwnPlan(record, needs, now, 'app', 'a')!, now,
    { appRunId: 'app', stepToken: 'a', runId: 'explore', result: 'completed' });
  expect(selectedOwnPlanStep(record, { energy: 70, boredom: 20 }, now)).toBe('calm_look_around');
  expect(selectedOwnPlanStep(record, { energy: 29, boredom: 20 }, now)).toBeNull();
});
it('abandons a crash claim and replans only unclaimed fresh state without resetting TTL or consumed starts', () => {
  const original = plan(), claimed = claimOwnPlan(original, needs, now, 'old-app', 'claim')!;
  expect(restoreOwnPlan(claimed, now).goals.find(g => g.kind === 'seek_novelty')?.status).toBe('abandoned');
  const completed = finishOwnPlan(claimed, now, { appRunId: 'old-app', stepToken: 'claim', runId: 'rest', result: 'completed' });
  const rebuilt = prepareOwnPlan(restoreOwnPlan(completed, now), { energy: 70, boredom: 70 }, now, true);
  expect(rebuilt.plan).toMatchObject({ steps: ['explore', 'calm_look_around'], stepIndex: 0, attempts: 1, claim: null });
  expect(rebuilt.goals.map(g => g.expiresAt)).toEqual(original.goals.map(g => g.expiresAt));
});
it('ends a failed step without retry and expires at the exact original boundary', () => {
  const record = plan(), claimed = claimOwnPlan(record, needs, now, 'app', 'a')!;
  const failed = finishOwnPlan(claimed, now, { appRunId: 'app', stepToken: 'a', runId: 'r', result: 'failed' });
  expect(failed.plan).toBeNull(); expect(failed.goals.find(g => g.kind === 'seek_novelty')?.status).toBe('cancelled');
  expect(selectedOwnPlanStep(record, needs, record.goals[0]!.expiresAt)).toBeNull();
});
