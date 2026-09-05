import {
  ActivityRunner,
  DEFAULT_ACTIVITY_COOLDOWN_RULES,
  EMPTY_COOLDOWNS,
  recordAction,
  recordRunResult,
  selectActivityForResolvedIntent,
  triggerCooldown,
  type ActivityCancelReason,
  type ActivityDefinition,
  type ActivityResult,
  type ActivityRunnerUpdate,
  type ActivityRuntimeState,
  type ActivitySelectionContext,
  type AnimationIntentTemplate,
  type CooldownRule,
  type CooldownState,
  type RepetitionHistory,
} from '../../domain/behavior/activity-runner';
import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import {
  createSystemAnimationIntent,
  type AnimationIntent,
  type AnimationIntentKind,
} from '../../domain/animation/animation-intent';
import type { CharacterAutonomySnapshot } from '../../domain/character';
import type { AutonomyClock } from './autonomy-coordinator';

export interface BrainActivityRuntimeOptions {
  readonly clock: AutonomyClock;
  readonly getCharacterSnapshot: () => CharacterAutonomySnapshot;
  readonly getSelectionContext: () => Pick<
    ActivitySelectionContext,
    'character' | 'synthesizedTone' | 'environment'
  >;
  readonly requestLocomotion: () => boolean;
  readonly cancelLocomotion: () => boolean;
  readonly createRunId: () => string;
  readonly cooldownRules?: readonly CooldownRule[];
  readonly onVisualIntent: (intent: AnimationIntent<AnimationIntentKind>) => void;
  readonly onTerminated: (result: ActivityResult) => void;
}

/** Application owner for exactly one ActivityRunner run and its external requests. */
export class BrainActivityRuntime {
  private readonly runner = new ActivityRunner();
  private readonly usedRunIds = new Set<string>();
  private definition: ActivityDefinition | null = null;
  private runtime: ActivityRuntimeState | null = null;
  private repetition: RepetitionHistory = { activities: [], actions: [] };
  private cooldowns: CooldownState = EMPTY_COOLDOWNS;

  public constructor(private readonly options: BrainActivityRuntimeOptions) {}

  public start(intent: BehaviorIntent, locomotionPrepared: boolean): boolean {
    const nowMs = this.options.clock.now();
    const definition = selectActivityForResolvedIntent(
      intent,
      {
        ...this.options.getSelectionContext(),
        repetition: this.repetition,
        cooldowns: this.cooldowns,
      },
      nowMs
    );
    if (definition === null) return false;
    this.cancel('higher_priority_activity');
    const runId = this.options.createRunId();
    requireRunId(runId, this.usedRunIds);
    const update = this.runner.start(definition, runId, nowMs);
    if (update.runtime === undefined) return false;
    this.definition = definition;
    this.runtime = update.runtime;
    this.applyCooldown(definition, 'start', nowMs);
    return this.applyUpdate(definition, update, locomotionPrepared);
  }

  public tick(nowMs: number): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const update = this.runner.tick(definition, runtime, nowMs);
    if (update.runtime === runtime && update.result === undefined) return false;
    return this.applyUpdate(definition, update, false);
  }

  public notifyLocomotionCompleted(): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const step = definition.steps.find((candidate) => candidate.id === runtime.currentStepId);
    if (step?.type !== 'locomotion') return false;
    return this.applyUpdate(
      definition,
      this.runner.update(
        definition,
        runtime,
        { type: 'locomotion_completed', runId: runtime.runId },
        this.options.clock.now()
      ),
      false
    );
  }

  public cancel(reason: ActivityCancelReason): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const update = this.runner.cancel(runtime, reason, this.options.clock.now());
    this.recordTerminal(definition, runtime, update.result!);
    this.definition = null;
    this.runtime = null;
    this.options.cancelLocomotion();
    return true;
  }

  public getRuntime(): ActivityRuntimeState | null {
    return this.runtime === null ? null : { ...this.runtime };
  }

  private applyUpdate(
    definition: ActivityDefinition,
    update: ActivityRunnerUpdate,
    locomotionPrepared: boolean
  ): boolean {
    if (update.result !== undefined) {
      const runtime = this.runtime;
      if (runtime !== null) this.recordTerminal(definition, runtime, update.result);
      this.definition = null;
      this.runtime = null;
      if (update.result.status !== 'completed') this.options.cancelLocomotion();
      this.options.onTerminated(update.result);
      return true;
    }
    if (update.runtime !== undefined) this.runtime = update.runtime;
    const step = update.emittedStep;
    if (step === undefined) return false;
    if (step.type === 'locomotion' && !locomotionPrepared && !this.options.requestLocomotion()) {
      const runtime = this.runtime;
      if (runtime === null) return false;
      return this.applyUpdate(
        definition,
        this.runner.cancel(runtime, 'environment_invalidated', this.options.clock.now()),
        false
      );
    }
    if (step.type === 'animation' || step.type === 'locomotion') {
      this.repetition = recordAction(this.repetition, {
        actionId: step.actionId,
        animationKind: step.intent.kind,
        shownAtMs: this.options.clock.now(),
      });
      this.options.onVisualIntent(this.animationIntentFor(step.intent));
    }
    return true;
  }

  private recordTerminal(
    definition: ActivityDefinition,
    runtime: ActivityRuntimeState,
    result: ActivityResult
  ): void {
    this.repetition = recordRunResult(this.repetition, runtime, result);
    if (result.status === 'completed') {
      this.applyCooldown(definition, 'completion', result.completedAtMs);
    } else if (result.status === 'cancelled') {
      this.applyCooldown(definition, 'cancelled', result.cancelledAtMs);
    }
  }

  private applyCooldown(
    definition: ActivityDefinition,
    trigger: 'start' | 'completion' | 'cancelled',
    nowMs: number
  ): void {
    const cooldownKey = definition.cooldownKey;
    if (cooldownKey === undefined) return;
    const rule = (this.options.cooldownRules ?? DEFAULT_ACTIVITY_COOLDOWN_RULES)
      .find((candidate) => candidate.key === cooldownKey);
    if (rule !== undefined) this.cooldowns = triggerCooldown(this.cooldowns, rule, trigger, nowMs);
  }

  private animationIntentFor(template: AnimationIntentTemplate): AnimationIntent<AnimationIntentKind> {
    return createSystemAnimationIntent(
      template.kind,
      this.options.getCharacterSnapshot().synthesizedTone,
      {
        ...(template.category === undefined ? {} : { category: template.category }),
        ...(template.expressionHint === undefined ? {} : { expressionHint: template.expressionHint }),
        ...(template.propHint === undefined ? {} : { propHint: template.propHint }),
        ...(template.loop === undefined ? {} : { loop: template.loop }),
      }
    );
  }
}

function requireRunId(id: string, used: Set<string>): void {
  if (id.trim().length === 0 || id.trim() !== id || id.length > 128) {
    throw new Error('Activity run ID must be a trimmed non-empty bounded string');
  }
  if (used.has(id)) throw new Error('Activity run ID must be unique within the Brain runtime');
  used.add(id);
}
