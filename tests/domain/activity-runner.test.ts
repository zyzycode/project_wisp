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
  selectActivityForResolvedIntent,
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
import type { EnvironmentSnapshot } from '../../src/domain/behavior';

function character(needs: Partial<CharacterState['needs']> = {}): CharacterState {
  return { needs: { energy: 70, attention: 10, play: 60, comfort: 20, boredom: 80, ...needs }, relationship: { friendship: 0, love: 0, loveUnlocked: false }, personality: { id: 'test', displayName: 'Test', aiSelfConcept: 'test', axes: { openness: axis(), extraversion: axis(), agreeableness: axis(), sensitivity: axis(), playfulness: axis(), boldness: axis(), independence: axis() } }, intimacy: { flirtiness: 0, romanticCharge: 0, userConsentEnabled: false, boundariesKnown: false }, preferences: {}, lastUpdated: 0 };
}
function axis() { return { base: .5, current: .5, softMin: 0, softMax: 1, hardMin: 0, hardMax: 1, plasticity: .5 }; }
const environment: EnvironmentSnapshot = {
  capturedAtMs: 0,
  screenBounds: { id: 'primary', x: 0, y: 0, width: 1000, height: 800 },
};
function context(overrides: Partial<ActivitySelectionContext> = {}): ActivitySelectionContext { return { character: character(), synthesizedTone: 'playful', environment, repetition: { activities: [], actions: [] }, cooldowns: EMPTY_COOLDOWNS, ...overrides }; }

describe('Domain: Activity Runner', () => {
  it('provides the specified Explore and Rest chains', () => {
    expect(EXPLORE_ACTIVITY.steps.map((step) => step.actionId)).toEqual(['walk:default', 'look_around']);
    expect(REST_ACTIVITY.steps.map((step) => step.actionId)).toEqual(['yawn', 'lie_down', 'sleep_start', 'sleep_loop']);
    expect(validateActivityDefinition(EXPLORE_ACTIVITY)).toBe(true);
    expect(validateActivityDefinition(REST_ACTIVITY)).toBe(true);
  });

  it('advances locomotion causally and visual phases only from Brain-owned deadlines', () => {
    const runner = new ActivityRunner();
    const started = runner.start(EXPLORE_ACTIVITY, 'run-1', 100);
    expect(started.runtime?.runId).toBe('run-1');
    expect(started.runtime).toMatchObject({
      stage: 'entering',
      stepStartedAtMs: 100,
      phaseEndsAtMs: 7_100,
    });
    const walked = runner.update(
      EXPLORE_ACTIVITY,
      started.runtime!,
      { type: 'locomotion_completed', runId: 'run-1' },
      200
    );
    expect(walked.runtime).toMatchObject({
      currentStepId: 'inspect',
      stage: 'looping',
      stepStartedAtMs: 200,
      phaseEndsAtMs: 2_400,
    });
    expect(runner.tick(EXPLORE_ACTIVITY, walked.runtime!, 2_399).runtime?.currentStepId)
      .toBe('inspect');
    expect(runner.tick(EXPLORE_ACTIVITY, walked.runtime!, 2_400).result?.status)
      .toBe('completed');
    expect(runner.start(EXPLORE_ACTIVITY, 'run-2', 300).runtime?.runId).toBe('run-2');
  });

  it('ignores a stale locomotion outcome from a cancelled run', () => {
    const runner = new ActivityRunner();
    const first = runner.start(EXPLORE_ACTIVITY, 'run-1', 0).runtime!;
    runner.interrupt(first, 'P1_user_interaction', 10);
    const second = runner.start(EXPLORE_ACTIVITY, 'run-2', 20).runtime!;
    expect(runner.update(EXPLORE_ACTIVITY, second, {
      type: 'locomotion_completed', runId: 'run-1',
    }, 30).runtime?.currentStepId).toBe('walk');
    expect(runner.update(EXPLORE_ACTIVITY, second, {
      type: 'locomotion_completed', runId: 'run-2',
    }, 30).runtime?.currentStepId).toBe('inspect');
  });

  it('ignores a stale guard result before applying any branch control flow', () => {
    const guarded: ActivityDefinition = {
      id: 'guarded', priority: 'P4_autonomous', baseWeight: 1, entryStepId: 'check',
      steps: [
        { id: 'check', actionId: 'check', stage: 'entering', type: 'branch', condition: 'can_continue', whenTrue: 'continue', whenFalse: 'cancel' },
        { id: 'continue', actionId: 'continue', stage: 'looping', type: 'delay', durationMs: 1 },
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

  it('uses the locomotion deadline as a bounded cleanup path', () => {
    const runner = new ActivityRunner();
    const runtime = runner.start(EXPLORE_ACTIVITY, 'run-timeout', 100).runtime!;

    expect(runner.tick(EXPLORE_ACTIVITY, runtime, 7_100)).toMatchObject({
      clearedRunId: 'run-timeout',
      result: { status: 'cancelled', reason: 'step_timeout', activityId: 'explore' },
    });
  });

  it('completes Rest entirely from monotonic deadlines', () => {
    const runner = new ActivityRunner();
    const yawn = runner.start(REST_ACTIVITY, 'run-rest', 0).runtime!;
    const lieDown = runner.tick(REST_ACTIVITY, yawn, 3_000).runtime!;
    const sleepStart = runner.tick(REST_ACTIVITY, lieDown, 6_000).runtime!;
    const sleepLoop = runner.tick(REST_ACTIVITY, sleepStart, 9_000).runtime!;

    expect(runner.tick(REST_ACTIVITY, sleepLoop, 12_000)).toMatchObject({
      clearedRunId: 'run-rest',
      result: { status: 'completed', activityId: 'rest', completedAtMs: 12_000 },
    });
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

  it('selects Zoomies for resolved play only when Domain needs and cooldown gates allow it', () => {
    const play = { kind: 'play', source: 'user', priority: 'high' } as const;
    expect(selectActivityForResolvedIntent(play, context(), 0)).toBe(ZOOMIES_ACTIVITY);
    expect(selectActivityForResolvedIntent(
      play,
      context({ character: character({ energy: 64 }) }),
      0
    )).toBeNull();
    const cooling = triggerCooldown(
      EMPTY_COOLDOWNS,
      { key: 'zoomies', durationMs: 1_000, startsOn: 'start' },
      'start',
      0
    );
    expect(selectActivityForResolvedIntent(play, context({ cooldowns: cooling }), 999))
      .toBeNull();
    expect(selectActivityForResolvedIntent(play, context({ cooldowns: cooling }), 1_000))
      .toBe(ZOOMIES_ACTIVITY);
  });

  it('rejects unresolved targets in invalid definitions', () => {
    const invalid: ActivityDefinition = { ...EXPLORE_ACTIVITY, entryStepId: 'missing' };
    expect(validateActivityDefinition(invalid)).toBe(false);
  });
});
