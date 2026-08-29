import { describe, expect, it } from 'vitest';
import {
  ActivityRunner,
  DEFAULT_REPETITION_PENALTY,
  EMPTY_COOLDOWNS,
  EXPLORE_ACTIVITY,
  REST_ACTIVITY,
  ZOOMIES_ACTIVITY,
  isCooldownEligible,
  isZoomiesEligible,
  recordAction,
  recordActivity,
  repetitionModifier,
  triggerCooldown,
  validateCooldownRule,
  validateRepetitionPenalty,
  type ActivityDefinition,
  type ActivitySelectionContext,
  type RepetitionHistory,
  validateActivityDefinition,
  weightedActivity,
  zoomiesNeedModifier,
} from '../../src/domain/behavior';
import type { CharacterState } from '../../src/domain/character';

function character(needs: Partial<CharacterState['needs']> = {}): CharacterState {
  return { needs: { energy: 70, attention: 10, play: 60, comfort: 20, boredom: 80, ...needs }, relationship: { friendship: 0, love: 0, loveUnlocked: false }, personality: { id: 'test', displayName: 'Test', aiSelfConcept: 'test', axes: { openness: axis(), extraversion: axis(), agreeableness: axis(), sensitivity: axis(), playfulness: axis(), boldness: axis(), independence: axis() } }, intimacy: { flirtiness: 0, romanticCharge: 0, userConsentEnabled: false, boundariesKnown: false }, preferences: {}, lastUpdated: 0 };
}
function axis() { return { base: .5, current: .5, softMin: 0, softMax: 1, hardMin: 0, hardMax: 1, plasticity: .5 }; }
function context(overrides: Partial<ActivitySelectionContext> = {}): ActivitySelectionContext { return { character: character(), synthesizedTone: 'playful', repetition: { activities: [], actions: [] }, cooldowns: EMPTY_COOLDOWNS, ...overrides }; }

describe('Domain: Activity Runner', () => {
  it('provides the specified Explore and Rest chains', () => {
    expect(EXPLORE_ACTIVITY.steps.map((step) => step.actionId)).toEqual(['walk', 'observe', 'sit', 'look_around', 'stand_up']);
    expect(REST_ACTIVITY.steps.map((step) => step.actionId)).toEqual(['yawn', 'lie_down', 'sleep_start', 'sleep_loop']);
    expect(validateActivityDefinition(EXPLORE_ACTIVITY)).toBe(true);
    expect(validateActivityDefinition(REST_ACTIVITY)).toBe(true);
  });

  it('advances a chain only from explicit completion and gives each run independent identity', () => {
    const runner = new ActivityRunner();
    const started = runner.start(EXPLORE_ACTIVITY, 'run-1', 100);
    expect(started.runtime?.runId).toBe('run-1');
    const advanced = runner.update(EXPLORE_ACTIVITY, started.runtime!, { type: 'animation_completed', runId: 'run-1', requestId: 'ignored' }, 200);
    expect(advanced.runtime?.currentStepId).toBe('walk');
    const walked = runner.tick(EXPLORE_ACTIVITY, started.runtime!, 7_100);
    expect(walked.runtime?.currentStepId).toBe('observe');
    expect(runner.start(EXPLORE_ACTIVITY, 'run-2', 300).runtime?.runId).toBe('run-2');
  });

  it('ignores a stale completion from a cancelled run and only accepts its active request', () => {
    const runner = new ActivityRunner();
    const first = runner.start(REST_ACTIVITY, 'run-1', 0).runtime!;
    runner.interrupt(first, 'P1_user_interaction', 10);
    const second = runner.start(REST_ACTIVITY, 'run-2', 20).runtime!;
    expect(runner.update(REST_ACTIVITY, second, { type: 'animation_completed', runId: 'run-1', requestId: first.activeAnimationRequestId! }, 30).runtime?.currentStepId).toBe('yawn');
    expect(runner.update(REST_ACTIVITY, second, { type: 'animation_completed', runId: 'run-2', requestId: 'late-request' }, 30).runtime?.currentStepId).toBe('yawn');
    expect(runner.update(REST_ACTIVITY, second, { type: 'animation_completed', runId: 'run-2', requestId: second.activeAnimationRequestId! }, 30).runtime?.currentStepId).toBe('lie_down');
  });

  it('ignores a stale guard result before applying any branch control flow', () => {
    const guarded: ActivityDefinition = {
      id: 'guarded', priority: 'P4_autonomous', baseWeight: 1, entryStepId: 'check',
      steps: [
        { id: 'check', actionId: 'check', type: 'branch', condition: 'can_continue', whenTrue: 'continue', whenFalse: 'cancel' },
        { id: 'continue', actionId: 'continue', type: 'delay', durationMs: 1 },
      ],
    };
    const runner = new ActivityRunner();
    const first = runner.start(guarded, 'run-1', 0).runtime!;
    runner.interrupt(first, 'P0_forced_physics', 1);
    const second = runner.start(guarded, 'run-2', 2).runtime!;
    expect(runner.update(guarded, second, { type: 'guard_evaluated', runId: 'run-1', condition: 'can_continue', value: true }, 3).runtime?.currentStepId).toBe('check');
    expect(runner.update(guarded, second, { type: 'guard_evaluated', runId: 'run-2', condition: 'can_continue', value: true }, 3).runtime?.currentStepId).toBe('continue');
  });

  it('cancels the current run for P0 forced motion and P1 drag', () => {
    const runner = new ActivityRunner();
    const runtime = runner.start(EXPLORE_ACTIVITY, 'run-1', 0).runtime!;
    expect(runner.interrupt(runtime, 'P0_forced_physics', 10)).toMatchObject({ clearedRunId: 'run-1', result: { status: 'cancelled', reason: 'forced_motion', activityId: 'explore' } });
    expect(runner.interrupt(runtime, 'P1_user_interaction', 10)).toMatchObject({ clearedRunId: 'run-1', result: { status: 'cancelled', reason: 'user_interaction', activityId: 'explore' } });
  });
});

describe('Domain: repetition and cooldowns', () => {
  it('uses bounded history and exponentially reduces, but never eliminates, repeated activities', () => {
    let history: RepetitionHistory = { activities: [], actions: [] };
    for (let i = 0; i < 12; i += 1) history = recordActivity(history, { activityId: 'explore', selectedAtMs: 0, result: 'completed' });
    for (let i = 0; i < 20; i += 1) history = recordAction(history, { actionId: 'walk', animationKind: 'walk', shownAtMs: 0 });
    expect(history.activities).toHaveLength(DEFAULT_REPETITION_PENALTY.activityHistorySize);
    expect(history.actions).toHaveLength(DEFAULT_REPETITION_PENALTY.actionHistorySize);
    const repeated = repetitionModifier(EXPLORE_ACTIVITY, history, 0);
    expect(repeated).toBeGreaterThanOrEqual(DEFAULT_REPETITION_PENALTY.minActivityMultiplier * DEFAULT_REPETITION_PENALTY.minActionMultiplier);
    expect(repeated).toBeLessThan(1);
    expect(repetitionModifier(EXPLORE_ACTIVITY, history, 10 * 60_000)).toBeGreaterThan(repeated);
  });

  it('applies cooldowns as hard gates at explicit monotonic times', () => {
    const state = triggerCooldown(EMPTY_COOLDOWNS, { key: 'zoomies', durationMs: 1_000, startsOn: 'start' }, 'start', 50);
    expect(isCooldownEligible(state, 'zoomies', 1_049)).toBe(false);
    expect(isCooldownEligible(state, 'zoomies', 1_050)).toBe(true);
    const anyFinish = { key: 'swat', durationMs: 1_000, startsOn: 'any_finish' as const };
    expect(triggerCooldown(EMPTY_COOLDOWNS, anyFinish, 'start', 50)).toBe(EMPTY_COOLDOWNS);
    expect(isCooldownEligible(triggerCooldown(EMPTY_COOLDOWNS, anyFinish, 'cancelled', 50), 'swat', 1_049)).toBe(false);
    expect(validateCooldownRule({ key: 'bad', durationMs: -1, startsOn: 'start' })).toBe(false);
    expect(validateRepetitionPenalty(DEFAULT_REPETITION_PENALTY)).toBe(true);
  });
});

describe('Domain: Zoomies selection', () => {
  it('requires all needs gates and cooldown expiry, with the specified quadratic weight', () => {
    const base = context();
    expect(isZoomiesEligible(base, 'zoomies', 0)).toBe(true);
    expect(zoomiesNeedModifier(base.character)).toBeCloseTo((.5 + 2.5 * .8 ** 2) * (.5 + 1.5 * .7 ** 2) * 1.1, 8);
    expect(isZoomiesEligible(context({ character: character({ energy: 64 }) }), 'zoomies', 0)).toBe(false);
    expect(isZoomiesEligible(context({ character: character({ boredom: 74 }) }), 'zoomies', 0)).toBe(false);
    expect(isZoomiesEligible(context({ character: character({ play: 49 }) }), 'zoomies', 0)).toBe(false);
    expect(isZoomiesEligible(context({ character: character({ comfort: 80 }) }), 'zoomies', 0)).toBe(false);
    const cooling = triggerCooldown(EMPTY_COOLDOWNS, { key: 'zoomies', durationMs: 1, startsOn: 'start' }, 'start', 0);
    expect(isZoomiesEligible(context({ cooldowns: cooling }), 'zoomies', 0)).toBe(false);
  });

  it('keeps a repeated sole candidate selectable at its penalty floor', () => {
    const repeated = context({ repetition: { activities: Array.from({ length: 8 }, () => ({ activityId: 'explore', selectedAtMs: 0, result: 'completed' as const })), actions: [] } });
    expect(weightedActivity([EXPLORE_ACTIVITY], repeated, 0, .5)).toBe(EXPLORE_ACTIVITY);
  });

  it('includes Zoomies in weighted selection only after all gates are met', () => {
    expect(weightedActivity([EXPLORE_ACTIVITY, ZOOMIES_ACTIVITY], context(), 0, .999)).toBe(ZOOMIES_ACTIVITY);
    expect(weightedActivity([EXPLORE_ACTIVITY, ZOOMIES_ACTIVITY], context({ character: character({ energy: 64 }) }), 0, .999)).toBe(EXPLORE_ACTIVITY);
  });

  it('rejects unresolved targets in invalid definitions', () => {
    const invalid: ActivityDefinition = { ...EXPLORE_ACTIVITY, entryStepId: 'missing' };
    expect(validateActivityDefinition(invalid)).toBe(false);
  });
});
