import { createRestSpotActivity, selectRestSpot } from '../../domain/behavior/rest-spot-planner';
import type { ExternalWindowSurface } from '../../domain/behavior/surface-kinematics';
import { createExternalRoute, createExploreTraversalSteps, type TraversalAction } from '../../domain/behavior/traversal-route';
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
  type ActivitySelectionCatalog,
  type ActivitySelectionContext,
  type AnimationIntentTemplate,
  type CooldownRule,
  type CooldownState,
  type RepetitionHistory,
} from '../../domain/behavior/activity-runner';
import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import {
  createExploreActivityDefinition,
  recordExplorePlan,
  selectExplorePlan,
  type ExploreHistory,
  type ExplorePlan,
} from '../../domain/behavior/explore-planner';
import type { CollisionInsets, Vector2Dto } from '../../domain/behavior/motion-engine';
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
  readonly getRootPosition: () => Vector2Dto;
  readonly getCollisionInsets: () => CollisionInsets;
  readonly nextRandom: () => number;
  readonly traversalEnabled?: boolean;
  readonly getExternalSurfaces?: () => readonly ExternalWindowSurface[];
  readonly requestLocomotion: (request: {
    readonly runId: string;
    readonly stepId: string;
    readonly traversal?: TraversalAction;
    readonly targetRef: string;
    readonly gait: 'walk' | 'run' | 'crawl';
    readonly targetRootPosition?: Vector2Dto;
  }) => boolean;
  readonly cancelLocomotion: (forDrag?: boolean) => boolean;
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
  private exploreHistory: ExploreHistory = { entries: [] };
  private explorePlan: ExplorePlan | null = null;

  public constructor(private readonly options: BrainActivityRuntimeOptions) {}

  public start(intent: BehaviorIntent, catalog?: ActivitySelectionCatalog): boolean {
    const nowMs = this.options.clock.now();
    const selectionContext = {
      ...this.options.getSelectionContext(),
      repetition: this.repetition,
      cooldowns: this.cooldowns,
    };
    const selectedDefinition = selectActivityForResolvedIntent(
      intent,
      selectionContext,
      nowMs,
      catalog === undefined ? 0 : this.options.nextRandom(),
      catalog
    );
    if (selectedDefinition === null) return false;
    const context = {
      currentRootPosition: this.options.getRootPosition(), environment: selectionContext.environment,
      collisionInsets: this.options.getCollisionInsets(), needs: selectionContext.character.needs,
      tone: selectionContext.synthesizedTone, history: this.exploreHistory, nowMs,
      externalSurfaces: this.options.getExternalSurfaces?.() ?? [],
    };
    if (selectedDefinition.id === 'rest' && intent.source !== 'user') {
      const rest = selectRestSpot(context, intent.reason !== 'vital_sleep');
      if (rest === null) return false;
      return this.startDefinition(createRestSpotActivity(rest), rest.target, nowMs);
    }
    const selectedExplorePlan = selectedDefinition.id === 'explore'
      ? selectExplorePlan({ ...context, isReachable: plan => {
          if (plan.targetSurface === undefined && context.environment.currentSurface?.kind !== 'window_top') return true;
          return this.options.traversalEnabled === true && createExternalRoute(plan, context) !== null;
        } }, this.options.nextRandom()) : null;
    if (selectedDefinition.id === 'explore' && selectedExplorePlan === null) return false;
    const definition = selectedExplorePlan === null ? selectedDefinition
      : createExploreActivityDefinition(selectedExplorePlan, this.options.traversalEnabled
          ? createExploreTraversalSteps(selectedExplorePlan, context) : []);
    return this.startDefinition(definition, selectedExplorePlan, nowMs);
  }

  private startDefinition(
    definition: ActivityDefinition,
    selectedExplorePlan: ExplorePlan | null,
    nowMs: number
  ): boolean {
    this.cancel('higher_priority_activity');
    const runId = this.options.createRunId();
    requireRunId(runId, this.usedRunIds);
    const update = this.runner.start(definition, runId, nowMs);
    if (update.runtime === undefined) return false;
    this.definition = definition;
    this.runtime = update.runtime;
    this.explorePlan = selectedExplorePlan;
    this.applyCooldown(definition, 'start', nowMs);
    this.applyUpdate(definition, update);
    if (this.runtime === null) return false;
    if (selectedExplorePlan !== null) {
      this.exploreHistory = recordExplorePlan(this.exploreHistory, selectedExplorePlan, nowMs);
    }
    return true;
  }

  public tick(nowMs: number): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const update = this.runner.tick(definition, runtime, nowMs);
    if (update.runtime === runtime && update.result === undefined) return false;
    return this.applyUpdate(definition, update);
  }

  public notifyLocomotionCompleted(completed?: { readonly runId: string; readonly stepId: string }): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const step = definition.steps.find((candidate) => candidate.id === runtime.currentStepId);
    if (step?.type !== 'locomotion' || (completed !== undefined
        && (completed.runId !== runtime.runId || completed.stepId !== runtime.currentStepId))) return false;
    return this.applyUpdate(
      definition,
      this.runner.update(
        definition,
        runtime,
        { type: 'locomotion_completed', runId: runtime.runId },
        this.options.clock.now()
      ),
    );
  }

  public cancel(reason: ActivityCancelReason, forDrag = false): boolean {
    const definition = this.definition;
    const runtime = this.runtime;
    if (definition === null || runtime === null) return false;
    const update = this.runner.cancel(runtime, reason, this.options.clock.now());
    this.recordTerminal(definition, runtime, update.result!);
    this.definition = null;
    this.runtime = null;
    this.explorePlan = null;
    this.options.cancelLocomotion(forDrag);
    return true;
  }

  public isJumpStep(): boolean {
    return this.definition?.steps.some((step) => step.id === this.runtime?.currentStepId
      && step.type === 'locomotion' && step.traversal?.kind === 'directed_jump') ?? false;
  }

  public getRuntime(): ActivityRuntimeState | null {
    return this.runtime === null ? null : { ...this.runtime };
  }

  public getExplorePlan(): ExplorePlan | null {
    return this.explorePlan === null
      ? null
      : { ...this.explorePlan, targetRootPosition: { ...this.explorePlan.targetRootPosition } };
  }

  private applyUpdate(
    definition: ActivityDefinition,
    update: ActivityRunnerUpdate
  ): boolean {
    if (update.result !== undefined) {
      const runtime = this.runtime;
      if (runtime !== null) this.recordTerminal(definition, runtime, update.result);
      this.definition = null;
      this.runtime = null;
      this.explorePlan = null;
      if (update.result.status !== 'completed') this.options.cancelLocomotion();
      this.options.onTerminated(update.result);
      return true;
    }
    if (update.runtime !== undefined) this.runtime = update.runtime;
    const step = update.emittedStep;
    if (step === undefined) return false;
    let supportTarget: Vector2Dto | undefined;
    if (step.type === 'locomotion' && step.supportLocalDistancePx !== undefined) {
      const surface = this.options.getSelectionContext().environment.currentSurface;
      if (surface?.kind !== 'window_top' || surface.id !== step.targetRef || !surface.isValidSupport
          || step.supportLocalDistancePx < 0 || step.supportLocalDistancePx > surface.bounds.width) {
        return this.applyUpdate(definition, this.runner.cancel(this.runtime!, 'environment_invalidated', this.options.clock.now()));
      }
      supportTarget = { x: surface.bounds.x + step.supportLocalDistancePx, y: surface.bounds.y };
    }
    if (step.type === 'locomotion' && !this.options.requestLocomotion({
      runId: this.runtime?.runId ?? '',
      stepId: step.id,
      traversal: step.traversal,
      targetRef: step.targetRef,
      gait: step.gait,
      ...(supportTarget !== undefined ? { targetRootPosition: supportTarget }
        : step.targetRootPosition !== undefined ? { targetRootPosition: step.targetRootPosition }
        : this.explorePlan === null ? {} : { targetRootPosition: this.explorePlan.targetRootPosition }),
    })) {
      const runtime = this.runtime;
      if (runtime === null) return false;
      return this.applyUpdate(
        definition,
        this.runner.cancel(runtime, 'environment_invalidated', this.options.clock.now()),
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
        ...(template.gazeDirection === undefined ? {} : { gazeDirection: template.gazeDirection }),
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
