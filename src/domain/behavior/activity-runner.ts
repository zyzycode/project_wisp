import type { AnimationIntent, AnimationIntentKind } from '../animation';
import type { CharacterState, SynthesizedEmotionalTone } from '../character';
import type { BehaviorIntent } from './behavior-intent';
import type { MonotonicMs } from './motion-engine';
import type { EnvironmentSnapshot } from './surface-kinematics';
import { createExploreActivityDefinition, DEFAULT_EXPLORE_PLAN } from './explore-planner';

export type ActivityId = string;
export type ActivityStepId = string;
export type ActivityActionId = string;
export type ActivityConditionId = string;
export type CooldownKey = string;
export type ActivityStepTarget = ActivityStepId | 'complete' | 'cancel';
export type ActivityPriorityClass = 'P0_forced_physics' | 'P1_user_interaction' | 'P2_critical_need' | 'P3_reactive' | 'P4_autonomous' | 'P5_ambient';
export type RunnableActivityPriorityClass = Exclude<ActivityPriorityClass, 'P0_forced_physics'>;
export type ActivityPhaseStage = 'entering' | 'looping' | 'exiting';

export interface AnimationIntentTemplate {
  readonly kind: AnimationIntentKind;
  readonly category?: AnimationIntent['category'];
  readonly expressionHint?: AnimationIntent['expressionHint'];
  readonly gazeDirection?: AnimationIntent['gazeDirection'];
  readonly propHint?: AnimationIntent['propHint'];
  readonly loop?: AnimationIntent['loop'];
}

export type ActivityStepCompletion = { readonly type: 'elapsed'; readonly durationMs: number };

export interface ActivityStepBase {
  readonly id: ActivityStepId;
  readonly actionId: ActivityActionId;
  readonly stage: ActivityPhaseStage;
  readonly guard?: ActivityConditionId;
  readonly next?: ActivityStepId | 'complete';
  readonly onGuardFalse?: ActivityStepTarget;
}
export interface AnimationActivityStep extends ActivityStepBase { readonly type: 'animation'; readonly intent: AnimationIntentTemplate; readonly completion: ActivityStepCompletion }
export interface VoluntaryLocomotionStep extends ActivityStepBase { readonly type: 'locomotion'; readonly gait: 'walk' | 'run' | 'crawl'; readonly targetRef: string; readonly intent: AnimationIntentTemplate; readonly timeoutMs: number }
export interface DelayActivityStep extends ActivityStepBase { readonly type: 'delay'; readonly durationMs: number }
export interface BranchActivityStep extends ActivityStepBase { readonly type: 'branch'; readonly condition: ActivityConditionId; readonly whenTrue: ActivityStepId | 'complete'; readonly whenFalse: ActivityStepTarget }
export type ActivityStep = AnimationActivityStep | VoluntaryLocomotionStep | DelayActivityStep | BranchActivityStep;

export interface ActivityDefinition {
  readonly id: ActivityId;
  readonly priority: RunnableActivityPriorityClass;
  readonly baseWeight: number;
  readonly entryStepId: ActivityStepId;
  readonly steps: readonly ActivityStep[];
  readonly cooldownKey?: CooldownKey;
  readonly tags?: readonly string[];
}

export interface RecentActivityEntry { readonly activityId: ActivityId; readonly selectedAtMs: MonotonicMs; readonly result: 'completed' | 'cancelled' }
export interface RecentActionEntry { readonly actionId: ActivityActionId; readonly animationKind: AnimationIntentKind; readonly shownAtMs: MonotonicMs }
export interface RepetitionHistory { readonly activities: readonly RecentActivityEntry[]; readonly actions: readonly RecentActionEntry[] }
export interface RepetitionPenalty { readonly activityHistorySize: number; readonly actionHistorySize: number; readonly activityHalfLifeMs: number; readonly actionHalfLifeMs: number; readonly activityStrength: number; readonly actionStrength: number; readonly minActivityMultiplier: number; readonly minActionMultiplier: number }
export const DEFAULT_REPETITION_PENALTY: RepetitionPenalty = { activityHistorySize: 8, actionHistorySize: 16, activityHalfLifeMs: 300_000, actionHalfLifeMs: 90_000, activityStrength: 0.9, actionStrength: 0.6, minActivityMultiplier: 0.15, minActionMultiplier: 0.25 };

export interface CooldownRule { readonly key: CooldownKey; readonly durationMs: number; readonly startsOn: 'start' | 'completion' | 'any_finish' }
export interface CooldownEntry { readonly key: CooldownKey; readonly nextEligibleAtMs: MonotonicMs }
export interface CooldownState { readonly entries: readonly CooldownEntry[] }
export const EMPTY_COOLDOWNS: CooldownState = { entries: [] };
export const DEFAULT_ZOOMIES_COOLDOWN_MS = 30_000;
export const DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS = 6_000;
export const DEFAULT_ACTIVITY_COOLDOWN_RULES: readonly CooldownRule[] = Object.freeze([
  Object.freeze({ key: 'zoomies', durationMs: DEFAULT_ZOOMIES_COOLDOWN_MS, startsOn: 'start' }),
  Object.freeze({
    key: 'observe_cursor',
    durationMs: DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS,
    startsOn: 'start',
  }),
]);

export type ActivityRuntimeStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export interface ActivityRuntimeState {
  readonly runId: string;
  readonly activityId: ActivityId;
  readonly status: ActivityRuntimeStatus;
  readonly currentStepId: ActivityStepId;
  readonly stage: ActivityPhaseStage;
  readonly startedAtMs: MonotonicMs;
  readonly stepStartedAtMs: MonotonicMs;
  readonly phaseEndsAtMs: MonotonicMs | null;
}
export type ActivityCancelReason = 'forced_motion' | 'user_interaction' | 'critical_need' | 'higher_priority_activity' | 'environment_invalidated' | 'animation_rejected' | 'step_timeout' | 'explicit_cancel' | 'application_shutdown';
export type ActivityResult = { readonly status: 'completed'; readonly activityId: ActivityId; readonly completedAtMs: MonotonicMs } | { readonly status: 'cancelled'; readonly activityId: ActivityId; readonly reason: ActivityCancelReason; readonly cancelledAtMs: MonotonicMs } | { readonly status: 'failed'; readonly activityId: ActivityId; readonly reason: 'invalid_definition' | 'unresolved_target'; readonly failedAtMs: MonotonicMs };
export type ActivityEvent =
  | { readonly type: 'locomotion_completed'; readonly runId: string }
  | { readonly type: 'guard_evaluated'; readonly runId: string; readonly condition: ActivityConditionId; readonly value: boolean };
export interface ActivityRunnerUpdate { readonly runtime?: ActivityRuntimeState; readonly emittedStep?: ActivityStep; readonly result?: ActivityResult; /** Only this run's external requests may be cleaned up. */ readonly clearedRunId?: string }

function validPositive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function stepMap(definition: ActivityDefinition): Map<string, ActivityStep> { return new Map(definition.steps.map((step) => [step.id, step])); }
function isUnconditionalCycle(definition: ActivityDefinition, steps: Map<string, ActivityStep>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id); visiting.add(id);
    const step = steps.get(id);
    const target = step?.type === 'branch' || step?.guard ? undefined : step?.next;
    const cyclic = target !== undefined && target !== 'complete' && target !== 'cancel' ? visit(target) : false;
    visiting.delete(id);
    return cyclic;
  };
  return visit(definition.entryStepId);
}
export function validateActivityDefinition(definition: ActivityDefinition): boolean {
  if (!validPositive(definition.baseWeight) || definition.steps.length === 0) return false;
  const steps = stepMap(definition);
  if (steps.size !== definition.steps.length || !steps.has(definition.entryStepId)) return false;
  if (isUnconditionalCycle(definition, steps)) return false;
  return definition.steps.every((step) => {
    const targets = step.type === 'branch' ? [step.whenTrue, step.whenFalse] : [step.next ?? 'complete', step.onGuardFalse ?? 'complete'];
    const durations = step.type === 'delay' ? [step.durationMs] : step.type === 'locomotion' ? [step.timeoutMs] : step.type === 'animation' ? [step.completion.durationMs] : [];
    return targets.every((target) => target === 'complete' || target === 'cancel' || steps.has(target)) && durations.every(validPositive);
  });
}

export function validateRepetitionPenalty(config: RepetitionPenalty): boolean {
  return Number.isInteger(config.activityHistorySize) && config.activityHistorySize > 0
    && Number.isInteger(config.actionHistorySize) && config.actionHistorySize > 0
    && validPositive(config.activityHalfLifeMs) && validPositive(config.actionHalfLifeMs)
    && validPositive(config.activityStrength) && validPositive(config.actionStrength)
    && config.minActivityMultiplier > 0 && config.minActivityMultiplier <= 1
    && config.minActionMultiplier > 0 && config.minActionMultiplier <= 1;
}
export function validateCooldownRule(rule: CooldownRule): boolean { return rule.key.length > 0 && Number.isFinite(rule.durationMs) && rule.durationMs >= 0; }

function stepDurationMs(step: ActivityStep): number | null {
  if (step.type === 'animation') return step.completion.durationMs;
  if (step.type === 'locomotion') return step.timeoutMs;
  if (step.type === 'delay') return step.durationMs;
  return null;
}
function runtimeForStep(runtime: ActivityRuntimeState, step: ActivityStep, nowMs: MonotonicMs): ActivityRuntimeState {
  const durationMs = stepDurationMs(step);
  return {
    ...runtime,
    currentStepId: step.id,
    stage: step.stage,
    stepStartedAtMs: nowMs,
    phaseEndsAtMs: durationMs === null ? null : nowMs + durationMs,
  };
}
function nextRuntime(definition: ActivityDefinition, runtime: ActivityRuntimeState, target: ActivityStepTarget, nowMs: MonotonicMs): ActivityRunnerUpdate {
  if (target === 'complete') return { result: { status: 'completed', activityId: runtime.activityId, completedAtMs: nowMs }, clearedRunId: runtime.runId };
  if (target === 'cancel') return { result: { status: 'cancelled', activityId: runtime.activityId, reason: 'explicit_cancel', cancelledAtMs: nowMs }, clearedRunId: runtime.runId };
  const step = stepMap(definition).get(target);
  if (!step) return { result: { status: 'failed', activityId: runtime.activityId, reason: 'unresolved_target', failedAtMs: nowMs } };
  const next = runtimeForStep(runtime, step, nowMs);
  return { runtime: next, emittedStep: step };
}

export class ActivityRunner {
  start(definition: ActivityDefinition, runId: string, nowMs: MonotonicMs): ActivityRunnerUpdate {
    if (!validateActivityDefinition(definition)) return { result: { status: 'failed', activityId: definition.id, reason: 'invalid_definition', failedAtMs: nowMs } };
    const first = stepMap(definition).get(definition.entryStepId)!;
    const runtime = runtimeForStep({
      runId,
      activityId: definition.id,
      status: 'running',
      currentStepId: first.id,
      stage: first.stage,
      startedAtMs: nowMs,
      stepStartedAtMs: nowMs,
      phaseEndsAtMs: null,
    }, first, nowMs);
    return { runtime, emittedStep: first };
  }
  update(definition: ActivityDefinition, runtime: ActivityRuntimeState, event: ActivityEvent, nowMs: MonotonicMs): ActivityRunnerUpdate {
    const step = stepMap(definition).get(runtime.currentStepId);
    if (!step) return { result: { status: 'failed', activityId: runtime.activityId, reason: 'unresolved_target', failedAtMs: nowMs } };
    if (event.runId !== runtime.runId) return { runtime };
    if (step.type === 'branch' && event.type === 'guard_evaluated' && event.condition === step.condition) return nextRuntime(definition, runtime, event.value ? step.whenTrue : step.whenFalse, nowMs);
    if (step.guard && event.type === 'guard_evaluated' && event.condition === step.guard && !event.value) return nextRuntime(definition, runtime, step.onGuardFalse ?? 'complete', nowMs);
    const complete = step.type === 'locomotion' && event.type === 'locomotion_completed';
    return complete ? nextRuntime(definition, runtime, step.next ?? 'complete', nowMs) : { runtime };
  }
  tick(definition: ActivityDefinition, runtime: ActivityRuntimeState, nowMs: MonotonicMs): ActivityRunnerUpdate {
    const step = stepMap(definition).get(runtime.currentStepId);
    if (!step) return { result: { status: 'failed', activityId: runtime.activityId, reason: 'unresolved_target', failedAtMs: nowMs } };
    if (runtime.phaseEndsAtMs !== null && nowMs >= runtime.phaseEndsAtMs) {
      return step.type === 'locomotion'
        ? this.cancel(runtime, 'step_timeout', nowMs)
        : nextRuntime(definition, runtime, step.next ?? 'complete', nowMs);
    }
    return { runtime };
  }
  interrupt(runtime: ActivityRuntimeState, priority: ActivityPriorityClass, nowMs: MonotonicMs): ActivityRunnerUpdate { return priority === 'P0_forced_physics' ? this.cancel(runtime, 'forced_motion', nowMs) : priority === 'P1_user_interaction' ? this.cancel(runtime, 'user_interaction', nowMs) : { runtime }; }
  cancel(runtime: ActivityRuntimeState, reason: ActivityCancelReason, nowMs: MonotonicMs): ActivityRunnerUpdate { return { result: { status: 'cancelled', activityId: runtime.activityId, reason, cancelledAtMs: nowMs }, clearedRunId: runtime.runId }; }
}

function decay(ageMs: number, halfLifeMs: number): number { return Math.exp(-Math.LN2 * Math.max(0, ageMs) / halfLifeMs); }
export function repetitionModifier(definition: ActivityDefinition, history: RepetitionHistory, nowMs: MonotonicMs, config: RepetitionPenalty = DEFAULT_REPETITION_PENALTY): number {
  const activityScore = history.activities.filter((entry) => entry.activityId === definition.id).reduce((sum, entry) => sum + decay(nowMs - entry.selectedAtMs, config.activityHalfLifeMs), 0);
  const visualSteps = definition.steps.filter((step): step is AnimationActivityStep | VoluntaryLocomotionStep => step.type === 'animation' || step.type === 'locomotion');
  const actionScore = history.actions.reduce((sum, entry) => sum + visualSteps.filter((step) => step.actionId === entry.actionId || step.intent.kind === entry.animationKind).length / Math.max(1, visualSteps.length) * decay(nowMs - entry.shownAtMs, config.actionHalfLifeMs), 0);
  return Math.max(config.minActivityMultiplier, Math.exp(-config.activityStrength * activityScore)) * Math.max(config.minActionMultiplier, Math.exp(-config.actionStrength * actionScore));
}
export function recordActivity(history: RepetitionHistory, entry: RecentActivityEntry, config: RepetitionPenalty = DEFAULT_REPETITION_PENALTY): RepetitionHistory { return { ...history, activities: [...history.activities, entry].slice(-config.activityHistorySize) }; }
export function recordAction(history: RepetitionHistory, entry: RecentActionEntry, config: RepetitionPenalty = DEFAULT_REPETITION_PENALTY): RepetitionHistory { return { ...history, actions: [...history.actions, entry].slice(-config.actionHistorySize) }; }
/** A cancelled activity counts only because every runtime has entered its first step. */
export function recordRunResult(history: RepetitionHistory, runtime: ActivityRuntimeState, result: ActivityResult, config: RepetitionPenalty = DEFAULT_REPETITION_PENALTY): RepetitionHistory {
  if (result.status === 'failed') return history;
  return recordActivity(history, { activityId: runtime.activityId, selectedAtMs: runtime.startedAtMs, result: result.status }, config);
}
export function isCooldownEligible(state: CooldownState, key: CooldownKey, nowMs: MonotonicMs): boolean { return nowMs >= (state.entries.find((entry) => entry.key === key)?.nextEligibleAtMs ?? Number.NEGATIVE_INFINITY); }
export type CooldownTrigger = 'start' | 'completion' | 'cancelled';
export function triggerCooldown(state: CooldownState, rule: CooldownRule, trigger: CooldownTrigger, nowMs: MonotonicMs): CooldownState { const applies = rule.startsOn === trigger || (rule.startsOn === 'any_finish' && trigger !== 'start'); if (!validateCooldownRule(rule) || !applies) return state; return { entries: [...state.entries.filter((entry) => entry.key !== rule.key), { key: rule.key, nextEligibleAtMs: nowMs + rule.durationMs }] }; }

export interface ActivitySelectionContext { readonly character: Readonly<Pick<CharacterState, 'needs'>>; readonly synthesizedTone: SynthesizedEmotionalTone; readonly environment: EnvironmentSnapshot; readonly repetition: RepetitionHistory; readonly cooldowns: CooldownState; readonly activePriority?: ActivityPriorityClass }
function unit(value: number | undefined): number { return Math.max(0, Math.min(1, (value ?? 0) / 100)); }
export function isZoomiesEligible(context: ActivitySelectionContext, cooldownKey = 'zoomies', nowMs = 0): boolean { const needs = context.character.needs; return unit(needs.energy) >= .65 && unit(needs.boredom) >= .75 && unit(needs.play) >= .5 && unit(needs.comfort) < .8 && isCooldownEligible(context.cooldowns, cooldownKey, nowMs); }
export function zoomiesNeedModifier(character: Readonly<Pick<CharacterState, 'needs'>>): number { const needs = character.needs; const b = unit(needs.boredom); const e = unit(needs.energy); const p = unit(needs.play); return (.5 + 2.5 * b ** 2) * (.5 + 1.5 * e ** 2) * (.5 + p); }
export function weightedActivity(definitions: readonly ActivityDefinition[], context: ActivitySelectionContext, nowMs: MonotonicMs, randomUnit: number, extraModifier: (definition: ActivityDefinition) => number = () => 1): ActivityDefinition | null { const weighted = definitions.filter((definition) => (!definition.cooldownKey || isCooldownEligible(context.cooldowns, definition.cooldownKey, nowMs)) && (definition.id !== ZOOMIES_ACTIVITY.id || isZoomiesEligible(context, definition.cooldownKey, nowMs))).map((definition) => ({ definition, weight: definition.baseWeight * repetitionModifier(definition, context.repetition, nowMs) * (definition.id === ZOOMIES_ACTIVITY.id ? zoomiesNeedModifier(context.character) : 1) * Math.max(0, extraModifier(definition)) })).filter((item) => item.weight > 0); const total = weighted.reduce((sum, item) => sum + item.weight, 0); if (total === 0) return null; let cursor = Math.max(0, Math.min(0.999999999, randomUnit)) * total; for (const item of weighted) { cursor -= item.weight; if (cursor <= 0) return item.definition; } return weighted[weighted.length - 1]?.definition ?? null; }

export const EXPLORE_ACTIVITY: ActivityDefinition = createExploreActivityDefinition(DEFAULT_EXPLORE_PLAN);
export const REST_ACTIVITY: ActivityDefinition = { id: 'rest', priority: 'P4_autonomous', baseWeight: 1, entryStepId: 'yawn', steps: [ { id: 'yawn', actionId: 'yawn', stage: 'entering', type: 'animation', intent: { kind: 'idle_blink' }, completion: { type: 'elapsed', durationMs: 3000 }, next: 'lie_down' }, { id: 'lie_down', actionId: 'lie_down', stage: 'entering', type: 'animation', intent: { kind: 'lie_down' }, completion: { type: 'elapsed', durationMs: 3000 }, next: 'sleep_start' }, { id: 'sleep_start', actionId: 'sleep_start', stage: 'entering', type: 'animation', intent: { kind: 'sleep_start' }, completion: { type: 'elapsed', durationMs: 3000 }, next: 'sleep_loop' }, { id: 'sleep_loop', actionId: 'sleep_loop', stage: 'looping', type: 'animation', intent: { kind: 'sleep_loop', loop: 'until_replaced' }, completion: { type: 'elapsed', durationMs: 3000 } } ] };
/** A rare P3 reactive sprint; gates and cooldown are enforced by weightedActivity. */
export const ZOOMIES_ACTIVITY: ActivityDefinition = { id: 'zoomies', priority: 'P3_reactive', baseWeight: .1, cooldownKey: 'zoomies', entryStepId: 'sprint', steps: [ { id: 'sprint', actionId: 'zoomies_sprint', stage: 'looping', type: 'locomotion', gait: 'run', targetRef: 'zoomies_target', intent: { kind: 'run' }, timeoutMs: 6000, next: 'settle' }, { id: 'settle', actionId: 'zoomies_settle', stage: 'exiting', type: 'animation', intent: { kind: 'settle' }, completion: { type: 'elapsed', durationMs: 3000 } } ] };

export interface ActivitySelectionCatalog {
  readonly play?: readonly ActivityDefinition[];
}

/** Pure Behavior Brain compatibility and eligibility selection for a resolved intent. */
export function selectActivityForResolvedIntent(
  intent: BehaviorIntent,
  context: ActivitySelectionContext,
  nowMs: MonotonicMs,
  randomUnit = 0,
  catalog: ActivitySelectionCatalog = {}
): ActivityDefinition | null {
  const candidates = intent.kind === 'wander'
    ? [EXPLORE_ACTIVITY]
    : intent.kind === 'sleep'
      ? [REST_ACTIVITY]
      : intent.kind === 'play'
        ? catalog.play ?? [ZOOMIES_ACTIVITY]
        : [];
  return weightedActivity(candidates, context, nowMs, randomUnit);
}
