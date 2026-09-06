import type { TraversalRequest } from '../domain/behavior/traversal-route';
import {
  AutonomyCoordinator,
  type AutonomyClock,
  type AutonomyScheduler,
  type AutonomyTraceEntry,
  type VoluntaryMovementController,
} from '../application/services/autonomy-coordinator';
import { BrainActivityRuntime } from '../application/services/brain-activity-runtime';
import type { BehaviorConfig, IPrng } from '../domain/behavior/autonomous-behavior';
import type { BehaviorIntent } from '../domain/behavior/behavior-intent';
import type { ActivityCancelReason } from '../domain/behavior/activity-runner';
import {
  createCursorObserveActivityCandidates,
  resolveCursorObserve,
} from '../domain/behavior/cursor-observe-policy';
import type { ExplorePlan } from '../domain/behavior/explore-planner';
import {
  CursorProximityEngine,
  DEFAULT_CURSOR_REACTION_CONSTRAINTS,
  type CursorProximityState,
} from '../domain/behavior/gaze-engine';
import type { MotionEvent, Vector2Dto } from '../domain/behavior/motion-engine';
import { AutonomyCharacterEngine, type CharacterAutonomySnapshot } from '../domain/character';
import {
  createSystemAnimationIntent,
  mapBehaviorIntentToAnimationIntent,
  type AnimationIntent,
} from '../domain/animation/animation-intent';
import {
  mapSleepWakeCommand,
  type SleepWakeCommand,
} from '../application/services/sleep-wake-command-mapper';
import type {
  BrainActivityTimelineDTO,
  BrainVisualIntentKindDTO,
  BodyInteractionTypeDTO,
} from '../shared/ipc-contracts';

export interface BrainVisualEpisode {
  readonly id: string;
  readonly startedAtMs: number;
  readonly intent: AnimationIntent<BrainVisualIntentKindDTO>;
}

export interface BrainLoopPolicy {
  readonly needsTickIntervalMs: number;
  readonly maxNeedsCatchUpSteps: number;
}

export const DEFAULT_BRAIN_LOOP_POLICY: BrainLoopPolicy = {
  needsTickIntervalMs: 1_000,
  maxNeedsCatchUpSteps: 4,
};

export interface MainAutonomyCompositionOptions {
  readonly clock: AutonomyClock;
  readonly scheduler: AutonomyScheduler;
  readonly prng: IPrng;
  readonly prngMetadata: { readonly algorithm: string; readonly seed: number };
  readonly getCharacterSnapshot: () => CharacterAutonomySnapshot;
  readonly tickNeeds?: (deltaMs: number) => void;
  readonly brainLoopPolicy?: BrainLoopPolicy;
  readonly movement: VoluntaryMovementController;
  readonly requestManualRootPosition: (targetRootPosition: Vector2Dto) => boolean;
  readonly behaviorConfig?: BehaviorConfig;
  readonly createVisualEpisodeId: () => string;
  readonly createActivityRunId?: () => string;
  readonly onPresentationChanged: () => void;
}

/** Main composition boundary for Character, Activity, cadence, and presentation. */
export class MainAutonomyComposition {
  private readonly character = new AutonomyCharacterEngine();
  private readonly coordinator: AutonomyCoordinator;
  private readonly activity: BrainActivityRuntime;
  private readonly usedVisualEpisodeIds = new Set<string>();
  private visualEpisode: BrainVisualEpisode;
  private activityRunSequence = 0;
  private started = false;
  private disposed = false;
  private lastBrainTickAtMs: number | null = null;
  private needsCatchUpMs = 0;
  private deferredUserInteractionResume = false;
  private enabled = true;
  private menuOpen = false;
  private cursorReactionActive = false;
  private stableRestSpotSleep = false;
  private jumpFallAtMs: number | null = null;
  private readonly cursorProximityEngine = new CursorProximityEngine();
  private cursorProximityState: CursorProximityState = {
    withinSwatRange: false,
    dwellWithinSwatRangeMs: 0,
    updatedAtMs: 0,
  };
  private lastCursorObservedAtMs: number | null = null;

  public constructor(private readonly options: MainAutonomyCompositionOptions) {
    validateBrainLoopPolicy(this.brainLoopPolicy());
    this.visualEpisode = this.createVisualEpisode('idle_blink');
    this.coordinator = new AutonomyCoordinator({
      clock: options.clock,
      scheduler: options.scheduler,
      prng: options.prng,
      prngMetadata: options.prngMetadata,
      character: this.character,
      getCharacterSnapshot: options.getCharacterSnapshot,
      movement: options.movement,
      onIntentResolved: (intent) => this.handleResolvedIntent(intent),
      onMovementStopped: () => this.setVisualKind('idle_blink', true),
      ...(options.behaviorConfig === undefined ? {} : { behaviorConfig: options.behaviorConfig }),
    });
    this.activity = new BrainActivityRuntime({
      clock: options.clock,
      getCharacterSnapshot: options.getCharacterSnapshot,
      getSelectionContext: () => {
        const snapshot = options.getCharacterSnapshot();
        return {
          character: snapshot,
          synthesizedTone: snapshot.synthesizedTone,
          environment: options.movement.getEnvironmentSnapshot(),
        };
      },
      getRootPosition: () => options.movement.getRootPosition(),
      getCollisionInsets: () => options.movement.getCollisionInsets(),
      nextRandom: () => options.prng.next(),
      traversalEnabled: options.movement.requestTraversal !== undefined,
      getExternalSurfaces: () => options.movement.getExternalSurfaces?.() ?? [],
      requestLocomotion: (request) => {
        if (request.traversal !== undefined) return options.movement.requestTraversal?.({
          runId: request.runId, stepId: request.stepId, action: request.traversal,
        }) ?? false;
        return this.coordinator.requestActivityLocomotion(request.targetRootPosition);
      },
      cancelLocomotion: (forDrag) => options.movement.cancelVoluntaryMovement(forDrag),
      createRunId: () => options.createActivityRunId?.() ?? `activity-${++this.activityRunSequence}`,
      onVisualIntent: (intent) => this.setVisualIntent(intent, true, true),
      onTerminated: (result) => {
        if (result.activityId === 'rest_spot_sleep' && result.status === 'completed') this.stableRestSpotSleep = true;
        if (result.activityId === 'rest_spot_nap' || (result.activityId === 'rest_spot_sleep' && result.status !== 'completed')) this.character.finishRest();
        if ((result.status !== 'completed' || (result.activityId !== 'rest' && result.activityId !== 'rest_spot_sleep'))
            && options.movement.canAcceptVoluntaryMovement()) {
          this.setVisualKind('idle_blink', true, result.activityId === 'observe_cursor');
        }
        if (result.activityId === 'observe_cursor' && this.cursorReactionActive) {
          this.cursorReactionActive = false;
          this.coordinator.resumeAfterReactiveActivity();
        } else {
          this.finishActivityCadence();
        }
      },
    });
  }

  public start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.lastBrainTickAtMs = this.options.clock.now();
    this.coordinator.start();
  }

  public stop(): void {
    if (this.disposed) return;
    this.cancelActivity('application_shutdown', false);
    this.started = false;
    this.resetBrainLoop();
    this.coordinator.stop();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.cancelActivity('application_shutdown', false);
    this.disposed = true;
    this.started = false;
    this.resetBrainLoop();
    this.coordinator.dispose();
  }

  /** Advances needs and Activity from one injected Main-monotonic Brain tick. */
  public tick(): boolean {
    if (!this.started || this.disposed) return false;
    const nowMs = this.options.clock.now();
    const previousTickAtMs = this.lastBrainTickAtMs ?? nowMs;
    this.lastBrainTickAtMs = nowMs;
    const elapsedMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - previousTickAtMs) : 0;
    this.expireCursorObservation(nowMs);
    const needsChanged = this.tickNeeds(elapsedMs);
    if (this.character.getSemanticSleepState() === 'sleeping'
        && this.activity.getRuntime()?.activityId !== 'rest_spot_nap'
        && this.options.getCharacterSnapshot().needs.energy >= 80) {
      this.character.resolveDirectIntent({ kind: 'wake', source: 'system', priority: 'normal', reason: 'restored_energy' }, this.options.getCharacterSnapshot());
      this.cancelActivity('user_interaction', false);
      this.setVisualKind('wake_up', true, true); this.finishActivityCadence();
    }
    const activityChanged = this.activity.tick(nowMs);
    const showFall = this.jumpFallAtMs !== null && nowMs >= this.jumpFallAtMs && this.activity.isJumpStep();
    if (showFall) { this.jumpFallAtMs = null; this.setVisualKind('fall', true, true); }
    return needsChanged || activityChanged || showFall;
  }

  public setEnabled(enabled: boolean): void {
    if (!enabled) this.cancelActivity('explicit_cancel', true);
    this.enabled = enabled;
    this.coordinator.setEnabled(enabled);
  }

  public setMenuOpen(menuOpen: boolean): void {
    if (menuOpen) this.cancelActivity('explicit_cancel', true);
    this.menuOpen = menuOpen;
    this.coordinator.setMenuOpen(menuOpen);
  }

  public getVisualEpisode(): BrainVisualEpisode {
    return { ...this.visualEpisode, intent: { ...this.visualEpisode.intent } };
  }

  public getActivityTimeline(): BrainActivityTimelineDTO | null {
    const runtime = this.activity.getRuntime();
    return runtime === null ? null : {
      runId: runtime.runId,
      activityId: runtime.activityId,
      phaseId: runtime.currentStepId,
      stage: runtime.stage,
      startedAtMs: runtime.startedAtMs,
      phaseStartedAtMs: runtime.stepStartedAtMs,
      phaseEndsAtMs: runtime.phaseEndsAtMs,
    };
  }

  public isSleepingForRecovery(): boolean {
    const runtime = this.activity.getRuntime();
    return this.character.getSemanticSleepState() === 'sleeping'
      && (runtime === null || runtime.currentStepId === 'sleep' || runtime.currentStepId === 'sleep_loop');
  }

  public getExplorePlan(): ExplorePlan | null {
    return this.activity.getExplorePlan();
  }

  public getDecisionTrace(): readonly AutonomyTraceEntry[] {
    return this.coordinator.getDecisionTrace();
  }

  public handleCursorObservation(screenPosition: Vector2Dto): boolean {
    if (!this.started || this.disposed) return false;
    const nowMs = this.options.clock.now();
    const compatible =
      this.enabled &&
      !this.menuOpen &&
      this.activity.getRuntime() === null &&
      this.visualEpisode.intent.kind === 'idle_blink' &&
      this.character.isAutonomyEligible() &&
      this.options.movement.canAcceptVoluntaryMovement();
    const proximity = this.cursorProximityEngine.update(this.cursorProximityState, {
      nowMs,
      rootGlobalPosition: this.options.movement.getRootPosition(),
      cursor: { globalPosition: screenPosition, capturedAtMs: nowMs },
      compatible,
    });
    this.cursorProximityState = proximity.state;
    this.lastCursorObservedAtMs = nowMs;
    if (!compatible || proximity.signal === undefined) return false;

    const snapshot = this.options.getCharacterSnapshot();
    const update = resolveCursorObserve({
      nowMs,
      signal: proximity.signal,
      needs: snapshot.needs,
      tone: snapshot.synthesizedTone,
      friendship: snapshot.relationship?.friendship ?? 0,
      noticeRandomUnit: this.options.prng.next(),
    });
    if (!update.noticed || update.zone === undefined) return false;

    const resolvedIntent = this.character.resolveDirectIntent({
      kind: 'play',
      source: 'system',
      priority: 'normal',
      reason: 'cursor_observe',
    }, snapshot).resolvedIntent;
    if (resolvedIntent === null) return false;

    const playCandidates = createCursorObserveActivityCandidates({
      zone: update.zone,
      needs: snapshot.needs,
      tone: snapshot.synthesizedTone,
      friendship: snapshot.relationship?.friendship ?? 0,
      gazeDirection: gazeDirectionTo(this.options.movement.getRootPosition(), screenPosition),
    });

    this.coordinator.suspendForReactiveActivity();
    this.cursorReactionActive = true;
    if (this.activity.start(resolvedIntent, { play: playCandidates })) return true;
    this.cursorReactionActive = false;
    this.coordinator.resumeAfterReactiveActivity();
    return false;
  }

  private expireCursorObservation(nowMs: number): void {
    const observedAtMs = this.lastCursorObservedAtMs;
    if (
      observedAtMs === null ||
      nowMs - observedAtMs <= DEFAULT_CURSOR_REACTION_CONSTRAINTS.signalMaxAgeMs
    ) return;
    this.cursorProximityState = this.cursorProximityEngine.update(this.cursorProximityState, {
      nowMs,
      rootGlobalPosition: this.options.movement.getRootPosition(),
      compatible: false,
    }).state;
    this.lastCursorObservedAtMs = null;
  }

  public requestSleepWake(command: SleepWakeCommand): boolean {
    const intent = this.character.resolveDirectIntent(
      mapSleepWakeCommand(command),
      this.options.getCharacterSnapshot()
    ).resolvedIntent;
    if (intent === null) return false;
    this.suspendForUserInteraction();
    if (!this.options.movement.canAcceptVoluntaryMovement()) { this.resumeAfterUserInteraction(); return false; }
    if (command.action === 'sleep') return this.activity.start(intent);
    this.setVisualKind('wake_up', true, true);
    this.resumeAfterUserInteraction();
    return true;
  }

  public handleClick(): boolean {
    const wasAwake = this.character.getSemanticSleepState() === 'awake';
    this.suspendForUserInteraction();
    if (!this.options.movement.canAcceptVoluntaryMovement()) { this.resumeAfterUserInteraction(); return true; }
    if (wasAwake) {
      this.setVisualKind('happy_reaction', true, true);
      this.resumeAfterUserInteraction();
      return true;
    }
    if (this.character.isAutonomyEligible()) {
      this.setVisualKind('wake_up', true, true); this.resumeAfterUserInteraction(); return true;
    }
    const intent = this.character.resolveDirectIntent(
      { kind: 'wake', source: 'user', priority: 'critical', reason: 'user_click_wake' },
      this.options.getCharacterSnapshot()
    ).resolvedIntent;
    if (intent === null) {
      this.resumeAfterUserInteraction();
      return false;
    }
    this.setVisualKind('wake_up', true, true);
    this.resumeAfterUserInteraction();
    return true;
  }

  public handleCharacterInteraction(type: BodyInteractionTypeDTO): boolean {
    if (type !== 'click') {
      this.cancelActivity('user_interaction', true);
      if (!this.options.movement.canAcceptVoluntaryMovement()) return false;
    }
    if (type === 'click') return this.handleClick();
    if (type === 'double_click' || type === 'pet' || type === 'feed') {
      this.setVisualKind('happy_reaction', true, true);
      return true;
    }
    if (type === 'think') {
      const intent = this.character.resolveDirectIntent(
        { kind: 'think', source: 'user', priority: 'normal', reason: 'user_think' },
        this.options.getCharacterSnapshot()
      ).resolvedIntent;
      if (intent === null) return false;
      this.handleResolvedIntent(intent);
      return true;
    }
    if (type !== 'play') return false;
    const intent = this.character.resolveDirectIntent(
      { kind: 'play', source: 'user', priority: 'high', reason: 'user_play' },
      this.options.getCharacterSnapshot()
    ).resolvedIntent;
    return intent !== null && this.activity.start(intent);
  }

  public beginDrag(): void {
    this.cancelActivity('user_interaction', true, true);
    this.coordinator.noteUserActivity();
    this.coordinator.interruptForcedMotion();
    this.character.resolveDirectIntent(
      { kind: 'drag', source: 'user', priority: 'critical', reason: 'user_drag' },
      this.options.getCharacterSnapshot()
    );
  }

  public suspendForUserInteraction(): void {
    this.cancelActivity('user_interaction', true);
    this.coordinator.suspendForUserInteraction();
  }

  public resumeAfterUserInteraction(): void {
    if (this.activity.getRuntime() !== null) {
      this.deferredUserInteractionResume = true;
      return;
    }
    this.coordinator.resumeAfterUserInteraction();
  }

  public requestManualRootPosition(targetRootPosition: Vector2Dto): boolean {
    this.cancelActivity('user_interaction', true);
    this.coordinator.suspendForManualMovement();
    const accepted = this.options.requestManualRootPosition(targetRootPosition);
    if (!accepted) this.coordinator.resumeAfterManualMovement();
    return accepted;
  }

  public handleMotionEvent(event: MotionEvent): void {
    if (event.type === 'airborne_started' && event.cause === 'voluntary_jump' && this.activity.isJumpStep()) return;
    if (event.type === 'jump_descending') {
      if (this.activity.isJumpStep()) this.jumpFallAtMs = Math.max(this.options.clock.now(),
        (this.activity.getRuntime()?.stepStartedAtMs ?? 0) + 120);
      return;
    }
    if (event.type === 'drag_started' || event.type === 'airborne_started') {
      this.cancelActivity('forced_motion', true);
      this.coordinator.interruptForcedMotion();
      this.setVisualKind(event.type === 'drag_started' ? 'dragged' : 'fall', true, true);
      return;
    }
    if (event.type === 'landed') {
      this.jumpFallAtMs = null;
      if (this.activity.isJumpStep()) return;
      this.setVisualKind(event.outcome === 'crash_landing' ? 'crash_landing' : 'land', true, true);
      this.coordinator.resumeAfterForcedMotion();
    }
  }

  public handleWindowSupportAttached(): void {
    // An autonomous route owns its landing; attaching must not cancel its continuation.
    if (this.activity.getRuntime() !== null) return;
    this.setVisualKind('land', true, true);
    this.coordinator.resumeAfterForcedMotion();
  }

  public handleSupportLost(): void {
    this.character.wakeForSupportLoss();
    this.cancelActivity('forced_motion', true);
    this.coordinator.interruptForcedMotion();
  }

  public notifyTraversalRejected(request: Pick<TraversalRequest, 'runId' | 'stepId'>): void {
    const runtime = this.activity.getRuntime();
    if (runtime?.runId !== request.runId || runtime.currentStepId !== request.stepId) return;
    if (this.cancelActivity('environment_invalidated', true)) this.finishActivityCadence();
  }

  public notifyVoluntaryMovementCompleted(completed?: Pick<TraversalRequest, 'runId' | 'stepId'>): void {
    if (!this.activity.notifyLocomotionCompleted(completed) && completed === undefined) {
      this.setVisualKind('idle_blink', false);
      this.coordinator.notifyVoluntaryMovementCompleted();
    }
  }

  private tickNeeds(elapsedMs: number): boolean {
    if (this.options.tickNeeds === undefined || elapsedMs <= 0) return false;
    const policy = this.brainLoopPolicy();
    const maximumCatchUpMs = policy.needsTickIntervalMs * policy.maxNeedsCatchUpSteps;
    this.needsCatchUpMs = Math.min(maximumCatchUpMs, this.needsCatchUpMs + elapsedMs);
    let appliedSteps = 0;
    while (this.needsCatchUpMs >= policy.needsTickIntervalMs) {
      this.options.tickNeeds(policy.needsTickIntervalMs);
      this.needsCatchUpMs -= policy.needsTickIntervalMs;
      appliedSteps += 1;
    }
    return appliedSteps > 0;
  }

  private handleResolvedIntent(intent: BehaviorIntent): boolean {
    if (this.activity.start(intent)) return true;
    if (intent.kind === 'wander') return false;
    if (intent.kind === 'sleep') { this.character.finishRest(); this.setVisualKind('idle_blink', true); return false; }
    this.setVisualIntent(
      mapBehaviorIntentToAnimationIntent(intent, this.options.getCharacterSnapshot().synthesizedTone),
      true,
      true
    );
    return true;
  }

  private finishActivityCadence(): void {
    if (this.deferredUserInteractionResume) {
      this.deferredUserInteractionResume = false;
      this.coordinator.resumeAfterUserInteraction();
    } else {
      this.coordinator.notifyActivityFinished();
    }
  }

  private cancelActivity(reason: ActivityCancelReason, publish: boolean, forDrag = false): boolean {
    this.jumpFallAtMs = null;
    const wasCursorReaction = this.cursorReactionActive;
    const restSpot = this.activity.getRuntime()?.activityId.startsWith('rest_spot_') ?? false;
    const cancelled = this.activity.cancel(reason, forDrag);
    if (this.stableRestSpotSleep) {
      this.stableRestSpotSleep = false; this.character.finishRest();
      if (publish) this.setVisualKind('idle_blink', true);
      if (!cancelled) return true;
    }
    if (!cancelled) return false;
    if (restSpot) this.character.finishRest();
    if (wasCursorReaction) {
      this.cursorReactionActive = false;
      this.coordinator.resumeAfterReactiveActivity();
    }
    const releaseUserInteraction = this.deferredUserInteractionResume;
    this.deferredUserInteractionResume = false;
    if (releaseUserInteraction) this.coordinator.resumeAfterUserInteraction();
    if (publish) {
      if (this.options.movement.canAcceptVoluntaryMovement()) this.setVisualKind('idle_blink', false, wasCursorReaction);
      this.options.onPresentationChanged();
    }
    return true;
  }

  private setVisualKind(kind: BrainVisualIntentKindDTO, publish: boolean, replay = false): void {
    if (!replay && this.visualEpisode.intent.kind === kind) return;
    this.visualEpisode = this.createVisualEpisode(kind);
    if (publish) this.options.onPresentationChanged();
  }

  private setVisualIntent(
    intent: AnimationIntent<BrainVisualIntentKindDTO>,
    publish: boolean,
    replay: boolean
  ): void {
    if (!replay && this.visualEpisode.intent.kind === intent.kind) return;
    this.visualEpisode = this.createVisualEpisode(intent);
    if (publish) this.options.onPresentationChanged();
  }

  private createVisualEpisode(
    source: BrainVisualIntentKindDTO | AnimationIntent<BrainVisualIntentKindDTO>
  ): BrainVisualEpisode {
    const id = this.options.createVisualEpisodeId();
    requireVisualEpisodeId(id, this.usedVisualEpisodeIds);
    const intent = typeof source === 'string'
      ? createSystemAnimationIntent(source, this.options.getCharacterSnapshot().synthesizedTone)
      : source;
    return { id, startedAtMs: this.options.clock.now(), intent: { ...intent } };
  }

  private resetBrainLoop(): void {
    this.lastBrainTickAtMs = null;
    this.needsCatchUpMs = 0;
    this.deferredUserInteractionResume = false;
  }

  private brainLoopPolicy(): BrainLoopPolicy {
    return this.options.brainLoopPolicy ?? DEFAULT_BRAIN_LOOP_POLICY;
  }
}

function gazeDirectionTo(origin: Vector2Dto, target: Vector2Dto): 'left' | 'right' | 'up' | 'down' {
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX < 0 ? 'left' : 'right';
  return deltaY < 0 ? 'up' : 'down';
}

function validateBrainLoopPolicy(policy: BrainLoopPolicy): void {
  if (!Number.isFinite(policy.needsTickIntervalMs) || policy.needsTickIntervalMs <= 0 ||
      !Number.isSafeInteger(policy.maxNeedsCatchUpSteps) || policy.maxNeedsCatchUpSteps <= 0) {
    throw new RangeError('Invalid Brain loop policy');
  }
}

function requireVisualEpisodeId(id: string, used: Set<string>): void {
  if (id.trim().length === 0 || id.trim() !== id || id.length > 128) {
    throw new Error('Visual episode ID must be a trimmed non-empty bounded string');
  }
  if (used.has(id)) throw new Error('Visual episode ID must be unique within the Brain runtime');
  used.add(id);
}
