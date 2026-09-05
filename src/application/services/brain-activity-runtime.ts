import {
  ActivityRunner,
  EXPLORE_ACTIVITY,
  REST_ACTIVITY,
  ZOOMIES_ACTIVITY,
  type ActivityCancelReason,
  type ActivityDefinition,
  type ActivityResult,
  type ActivityRunnerUpdate,
  type ActivityRuntimeState,
  type AnimationIntentTemplate,
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
  readonly requestLocomotion: () => boolean;
  readonly cancelLocomotion: () => boolean;
  readonly createRunId: () => string;
  readonly onVisualIntent: (intent: AnimationIntent<AnimationIntentKind>) => void;
  readonly onTerminated: (result: ActivityResult) => void;
}

/** Application owner for exactly one ActivityRunner run and its external requests. */
export class BrainActivityRuntime {
  private readonly runner = new ActivityRunner();
  private readonly usedRunIds = new Set<string>();
  private definition: ActivityDefinition | null = null;
  private runtime: ActivityRuntimeState | null = null;

  public constructor(private readonly options: BrainActivityRuntimeOptions) {}

  public start(intent: BehaviorIntent, locomotionPrepared: boolean): boolean {
    const definition = activityForIntent(intent);
    if (definition === null) return false;
    this.cancel('higher_priority_activity');
    const runId = this.options.createRunId();
    requireRunId(runId, this.usedRunIds);
    const update = this.runner.start(definition, runId, this.options.clock.now());
    if (update.runtime === undefined) return false;
    this.definition = definition;
    this.runtime = update.runtime;
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
    const runtime = this.runtime;
    if (runtime === null) return false;
    this.runner.cancel(runtime, reason, this.options.clock.now());
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
      this.options.onVisualIntent(this.animationIntentFor(step.intent));
    }
    return true;
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

function activityForIntent(intent: BehaviorIntent): ActivityDefinition | null {
  if (intent.kind === 'wander') return EXPLORE_ACTIVITY;
  if (intent.kind === 'sleep') return REST_ACTIVITY;
  if (intent.kind === 'play') return ZOOMIES_ACTIVITY;
  return null;
}

function requireRunId(id: string, used: Set<string>): void {
  if (id.trim().length === 0 || id.trim() !== id || id.length > 128) {
    throw new Error('Activity run ID must be a trimmed non-empty bounded string');
  }
  if (used.has(id)) throw new Error('Activity run ID must be unique within the Brain runtime');
  used.add(id);
}
