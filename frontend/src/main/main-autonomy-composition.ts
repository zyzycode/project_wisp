import type { CursorGameResult } from '../application/ports/cursor-game-contract';
import { CursorGamePresentation } from '../application/services/cursor-game-presentation';
import type { IPlatformAdapter } from '../application/ports/platform-adapter.interface';
import type { SystemIdlePort } from '../application/ports/system-idle.port';
import { MainSystemIdle } from './main-system-idle';
import type { GameObservation } from '../domain/behavior/cursor-game';
import { requiresVitalSleep, permitsAutomaticWake, isQuietCompatible } from '../domain/character/autonomy-character-engine';
import { LANDING_RECOVERY_MS } from '../domain/behavior/autonomous-behavior';
import { ProviderBehaviorAdmission } from '../application/services/provider-behavior-admission';
import type { ProviderBehaviorOffer, BehaviorTurnContext, BehaviorAdmissionReceipt, BehaviorAdmissionRejection } from '../application/ports/behavior-admission-port';
import { SocialBidFollowupPolicy, type SocialFollowupTicket } from '../domain/behavior/social-bid-followup-policy';
import { createSocialBidActivity } from '../domain/behavior/social-bid-activity';
import { InitiativeBudget, INITIATIVE_TUNING } from '../application/services/initiative-budget';
import { createCursorInterestActivity } from '../domain/behavior/cursor-interest-activity';
import type { ActivityOutcomeFeedback } from '../application/ports/shimeji-feedback-port';
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
  canPlayWithCursor,
  DEFAULT_CURSOR_OBSERVE_CONSTRAINTS,
  resolveCursorObserve,
} from '../domain/behavior/cursor-observe-policy';
import type { ExplorePlan } from '../domain/behavior/explore-planner';
import { DEFAULT_CURSOR_REACTION_CONSTRAINTS } from '../domain/behavior/gaze-engine';
import { MainCursorObservationState } from './main-cursor-observation-state';
import { MainVisualEpisodeState, type BrainVisualEpisode } from './main-visual-episode-state';
export type { BrainVisualEpisode } from './main-visual-episode-state';
import type { MotionEvent, Vector2Dto } from '../domain/behavior/motion-engine';
import { AutonomyCharacterEngine, type CharacterAutonomySnapshot } from '../domain/character';
import {
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

export interface BrainLoopPolicy {
  readonly needsTickIntervalMs: number;
  readonly maxNeedsCatchUpSteps: number;
}

export const DEFAULT_BRAIN_LOOP_POLICY: BrainLoopPolicy = {
  needsTickIntervalMs: 1_000,
  maxNeedsCatchUpSteps: 60,
};

export interface MainAutonomyCompositionOptions {
  readonly systemIdle?: SystemIdlePort;
  readonly routine?: ConstructorParameters<typeof MainSystemIdle>[0]['routine'];
  readonly routineCalendar?: ConstructorParameters<typeof MainSystemIdle>[0]['calendar'];
  readonly wallNow?: () => number;
  readonly onUnsolicitedBlocked?: () => void;
  readonly cursorPosition?: Pick<IPlatformAdapter, 'getCursorScreenPosition'>;
  readonly locale?: 'ru' | 'en';
  readonly clock: AutonomyClock;
  readonly scheduler: AutonomyScheduler;
  readonly prng: IPrng;
  readonly prngMetadata: { readonly algorithm: string; readonly seed: number };
  readonly getCharacterSnapshot: () => CharacterAutonomySnapshot;
  readonly onCursorGameResult?: (result: CursorGameResult) => void;
  readonly onActivityStarted?: (runId: string, activityId: string) => void;
  readonly onSocialBidStarted?: (runId: string, atMs: number) => void;
  readonly onAIInvalidated?: () => void;
  readonly onUserContact?: () => void;
  readonly onActivityOutcome?: (event: ActivityOutcomeFeedback) => void;
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
  private readonly providerAdmission: ProviderBehaviorAdmission;
  private readonly systemIdle: MainSystemIdle;
  private readonly visuals: MainVisualEpisodeState;
  private readonly localHistory: { kind: string; atMs: number }[] = [];
  private activityRunSequence = 0;
  private started = false;
  private disposed = false;
  private lastBrainTickAtMs: number | null = null;
  private needsCatchUpMs = 0;
  private deferredUserInteractionResume = false;
  private enabled = true;
  private quiet = false;
  private quietSupport = false;
  private menuOpen = false;
  private cursorReactionActive = false;
  private readonly socialFollowup = new SocialBidFollowupPolicy();
  private startingSocial: 'first' | SocialFollowupTicket | null = null;
  private secondRunId: string | null = null;
  private initiativeStartSequence = 0;
  private dialoguePending = false;
  private dialogueGuardUntilMs = 0;
  private lastDialogueTerminal: string | null = null;
  private readonly initiativeBudget = new InitiativeBudget();
  private cursorEpisode: { endsAtMs: number; supportId: string | undefined } | null = null;
  private readonly gamePresentation: CursorGamePresentation;
  private readonly cursor = new MainCursorObservationState();
  private stableRestSpotSleep = false;
  private jumpFallAtMs: number | null = null;

  public constructor(private readonly options: MainAutonomyCompositionOptions) {
    this.systemIdle = new MainSystemIdle({ source: options.systemIdle, routine: options.routine, calendar: options.routineCalendar, now: () => options.clock.now(),
      wallNow: options.wallNow ?? Date.now, onInvalidated: () => this.socialFollowup.invalidate(), onBlocked: () => this.blockUnsolicited() });
    this.gamePresentation = new CursorGamePresentation(() => options.clock.now(), () => options.locale ?? 'ru');
    validateBrainLoopPolicy(this.brainLoopPolicy());
    this.visuals = new MainVisualEpisodeState({ now: () => options.clock.now(),
      tone: () => options.getCharacterSnapshot().synthesizedTone, createId: options.createVisualEpisodeId });
    this.coordinator = new AutonomyCoordinator({
      clock: options.clock,
      scheduler: options.scheduler,
      prng: options.prng,
      prngMetadata: options.prngMetadata,
      character: this.character,
      getCharacterSnapshot: options.getCharacterSnapshot,
      movement: options.movement,
      beforeLocalOpportunity: () => {
        const previous = this.initiativeStartSequence;
        this.drainSocialAdmission();
        return this.initiativeStartSequence !== previous;
      },
      getLocalSelection: () => ({ nowMs: options.clock.now(), history: this.localHistory,
        quiet: this.quiet || this.quietSupport,
        canSocial: this.socialFollowup.canStartFirst() && !this.systemIdle.isBlocked() && this.initiativeBudget.available(options.clock.now()),
        canExplore: this.activity.canStart({ kind: 'wander', source: 'timer', priority: 'normal' }),
        canPlay: this.activity.canStart({ kind: 'play', source: 'timer', priority: 'normal' }),
        canRest: this.activity.canStart({ kind: 'sleep', source: 'timer', priority: 'normal' }) }),
      onIntentResolved: (intent) => this.handleResolvedIntent(intent),
      onMovementStopped: () => this.setVisualKind('idle_blink', true),
      ...(options.behaviorConfig === undefined ? {} : { behaviorConfig: options.behaviorConfig }),
    });
    this.activity = new BrainActivityRuntime({
      clock: options.clock,
      getCursorObservation: () => this.getCursorObservation(),
      onCursorGamePhase: (runId, phase, outcome) => this.gamePresentation.phase(runId, phase, outcome),
      onCursorGameResult: result => { this.gamePresentation.terminal(result.activityRunId, result.outcome); options.onCursorGameResult?.(result); },
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
        return this.coordinator.requestActivityLocomotion(request.targetRootPosition, request.gait);
      },
      cancelLocomotion: (forDrag) => options.movement.cancelVoluntaryMovement(forDrag),
      createRunId: () => options.createActivityRunId?.() ?? `activity-${++this.activityRunSequence}`,
      onRunCommitted: (runId, activityId) => {
        if (this.activity.isInitiative()) this.initiativeStartSequence++;
        if (activityId !== 'social_bid' || this.startingSocial === null) return;
        this.initiativeBudget.start(options.clock.now());
        if (this.startingSocial === 'first') this.socialFollowup.firstStarted(runId);
        else { this.socialFollowup.secondStarted(this.startingSocial, runId, options.clock.now()); this.secondRunId = runId; }
      },
      onStarted: (runId, activityId) => { if (runId !== this.secondRunId) options.onActivityStarted?.(runId, activityId); },
      onOutcome: event => { if (event.activityRunId === this.secondRunId) return; options.onActivityOutcome?.(event); this.coordinator.noteActivityOutcome(event); },
      onVisualIntent: (intent) => this.setVisualIntent(intent, true, true),
      onSettled: (runId, result) => {
        this.socialFollowup.terminal(runId, result.status, result.status === 'completed' ? result.completedAtMs
          : result.status === 'cancelled' ? result.cancelledAtMs : result.failedAtMs);
        if (this.secondRunId === runId) this.secondRunId = null;
        this.providerAdmission?.terminated(runId, result);
      },
      onTerminated: (result) => {
        if (result.activityId === 'rest_spot_sleep' && result.status === 'completed') this.stableRestSpotSleep = true;
        if (result.activityId === 'rest_spot_nap' || (result.activityId === 'rest_spot_sleep' && result.status !== 'completed')) this.character.finishRest();
        if ((result.status !== 'completed' || (result.activityId !== 'rest' && result.activityId !== 'rest_spot_sleep'))
            && options.movement.canAcceptVoluntaryMovement()) {
          this.setVisualKind('idle_blink', true, result.activityId === 'observe_cursor');
        }
        if (this.cursorReactionActive) {
          this.cursorReactionActive = false;
          this.cursorEpisode = null;
          this.coordinator.resumeAfterReactiveActivity();
        } else {
          this.finishActivityCadence();
        }
      },
    });
    this.providerAdmission = new ProviderBehaviorAdmission({
      now: () => options.clock.now(),
      gate: intent => this.providerGate(intent),
      safeToStart: () => options.movement.canAcceptVoluntaryMovement(),
      canDefer: () => this.activity.isTraversalStep(),
      cancel: () => { this.cancelActivity('step_timeout', true); this.finishActivityCadence(); },
      start: intent => {
        // Selection is checked before cancelling the current local run.
        if (!this.activity.canStart(intent)) return null;
        this.cancelActivity('higher_priority_activity', false);
        const resolved = this.character.resolveProviderIntent(intent, options.getCharacterSnapshot());
        if (!resolved) return null;
        this.coordinator.suspendForReactiveActivity();
        if (!this.activity.start(resolved)) { this.coordinator.resumeAfterReactiveActivity(); return null; }
        return this.activity.getRuntime();
      },
    });
  }

  public start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.systemIdle.setEnabled(this.enabled);
    this.lastBrainTickAtMs = this.options.clock.now();
    this.coordinator.start();
  }

  public stop(): void {
    this.invalidateSocialFollowup();
    this.options.onAIInvalidated?.();
    if (this.disposed) return;
    this.providerAdmission.invalidate('disposed');
    this.cancelActivity('application_shutdown', false);
    this.started = false;
    this.systemIdle.setEnabled(false);
    this.resetBrainLoop();
    this.coordinator.stop();
  }

  public dispose(): void {
    this.socialFollowup.reset();
    this.options.onAIInvalidated?.();
    if (this.disposed) return;
    this.providerAdmission.invalidate('disposed');
    this.cancelActivity('application_shutdown', false);
    this.disposed = true;
    this.systemIdle.dispose();
    this.started = false;
    this.resetBrainLoop();
    this.coordinator.dispose();
  }

  /** Windowless application capture: no needs, Activity, Motion, admission or AI. */
  public tickBackgroundSampling(): void {
    if (!this.disposed && this.options.routine) this.systemIdle.tick(false);
  }

  /** Advances needs and Activity from one injected Main-monotonic Brain tick. */
  public tick(): boolean {
    if (!this.started || this.disposed) return false;
    const returnCandidate = this.systemIdle.tick(!this.quiet && !this.quietSupport && !this.menuOpen);
    const nowMs = this.options.clock.now();
    const previousTickAtMs = this.lastBrainTickAtMs ?? nowMs;
    if (!Number.isFinite(nowMs) || nowMs < previousTickAtMs) return false;
    this.lastBrainTickAtMs = nowMs;
    const elapsedMs = Number.isFinite(nowMs) ? Math.max(0, nowMs - previousTickAtMs) : 0;
    this.expireCursorObservation(nowMs);
    const speechChanged = this.gamePresentation.tick();
    const needsChanged = this.tickNeeds(elapsedMs);
    if (this.character.getSemanticSleepState() === 'sleeping'
        && permitsAutomaticWake(this.options.getCharacterSnapshot())) {
      this.character.resolveDirectIntent({ kind: 'wake', source: 'system', priority: 'normal', reason: 'restored_energy' }, this.options.getCharacterSnapshot());
      this.cancelActivity('user_interaction', false);
      this.setVisualKind('wake_up', true, true); this.finishActivityCadence();
    }
    if (this.activity.getRuntime()?.activityId !== 'cursor_interest' && this.cursorEpisode && (nowMs >= this.cursorEpisode.endsAtMs ||
        this.options.movement.getEnvironmentSnapshot().currentSurface?.id !== this.cursorEpisode.supportId)) {
      this.cancelActivity('environment_invalidated', true);
    }
    if (this.character.isAutonomyEligible() && requiresVitalSleep(this.options.getCharacterSnapshot())
        && this.options.movement.canAcceptVoluntaryMovement() && this.enabled && !this.menuOpen
        && !this.deferredUserInteractionResume) {
      this.providerAdmission.invalidate('critical_need');
      this.cancelActivity('critical_need', false);
      const resolution = this.character.resolveAutonomousOpportunity({ context: { decisionSequence: 0, opportunityAtMs: nowMs,
        tone: this.options.getCharacterSnapshot().synthesizedTone }, snapshot: this.options.getCharacterSnapshot(),
        candidates: [{ kind: 'sleep', source: 'system', priority: 'high' }], prng: this.options.prng });
      if (resolution.resolvedIntent) this.handleResolvedIntent(resolution.resolvedIntent);
    }
    this.providerAdmission.tick();
    const returnStarted = returnCandidate && this.tryReturn();
    const cursorChanged = !returnStarted && this.pollCursor(nowMs);
    const activityChanged = this.activity.tick(nowMs);
    const secondStarted = this.trySocialFollowup();
    const reactionChanged = this.finishDirectReaction(nowMs);
    const showFall = this.jumpFallAtMs !== null && nowMs >= this.jumpFallAtMs && this.activity.isJumpStep();
    if (showFall) { this.jumpFallAtMs = null; this.setVisualKind('fall', true, true); }
    return secondStarted || returnStarted || needsChanged || activityChanged || reactionChanged || showFall || speechChanged || cursorChanged;
  }

  private finishDirectReaction(nowMs: number): boolean {
    if (this.activity.getRuntime() !== null) return false;
    const kind = this.visuals.current.intent.kind;
    const durationMs = kind === 'happy_reaction' || kind === 'confused_reaction' || kind === 'spook'
      ? 3000 : kind === 'wake_up' ? 1500 : kind === 'land' ? LANDING_RECOVERY_MS.normal
      : kind === 'crash_landing' ? LANDING_RECOVERY_MS.crash : null;
    if (durationMs === null || nowMs < this.visuals.current.startedAtMs + durationMs) return false;
    this.setVisualKind(kind === 'land' || kind === 'crash_landing' ? 'settle' : 'idle_blink', true);
    return true;
  }

  public getGlobalCursorSample(): GameObservation['cursor'] {
    return this.cursor.getGlobalSample();
  }

  private getCursorObservation(): GameObservation {
    const root = this.options.movement.getRootPosition();
    const dwellMs = this.cursor.getDwell(this.options.clock.now(), root);
    return { root, cursor: this.cursor.latest, environment: this.options.movement.getEnvironmentSnapshot(),
      collisionInsets: this.options.movement.getCollisionInsets(), dwellMs };
  }

  public getCursorGamePresentation() { this.gamePresentation.tick(); if (this.quietSupport) this.gamePresentation.suppressSpeech(); return this.gamePresentation.get(); }
  public observeDialoguePresentation(value: import('../shared/ipc-contracts').DialoguePresentationDTO): void {
    this.gamePresentation.observeDialogue(value);
    if (value.turn.phase === 'idle' && value.canSubmit) this.dialoguePending = false;
    if (value.turn.phase === 'thinking') this.dialoguePending = true;
    if (value.turn.phase === 'completed' || value.turn.phase === 'error') {
      this.dialoguePending = false;
      const key = `${value.conversationId}:${value.turn.requestId}:${value.turn.phase}`;
      if (key !== this.lastDialogueTerminal) { this.lastDialogueTerminal = key; this.dialogueGuardUntilMs = this.options.clock.now() + 5000; }
    }
  }
  public resetCursorGame(): void { if (this.activity.getRuntime()?.activityId === 'cursor_interest') this.cancelActivity('explicit_cancel', true); this.resetCursorInterest(); this.gamePresentation.reset(); }
  public resetSystemIdle(): void { this.invalidateSocialFollowup(); this.systemIdle.reset(); }
  public invalidateSocialFollowup(): void { this.socialFollowup.invalidate(); this.dialoguePending = false; }
  public resetSocialFollowupMemory(): void { this.socialFollowup.reset(); this.dialoguePending = false; }
  public acceptUserContact(): void { this.socialFollowup.contact(); }
  public acceptDialogueContact(): void { this.acceptUserContact(); this.dialoguePending = true; }

  public spendObservationBudget(atMs: number): boolean { return this.initiativeBudget.start(atMs); }

  public getAIEventState(): { allowed: boolean; touchAllowed: boolean; activeRunId: string | null; localSpeech: boolean } {
    return { allowed: !this.systemIdle.isBlocked() && this.started && !this.disposed && this.enabled && !this.quiet && !this.quietSupport && !this.menuOpen
      && !this.deferredUserInteractionResume && this.character.isAutonomyEligible() && !requiresVitalSleep(this.options.getCharacterSnapshot())
      && this.options.movement.canAcceptVoluntaryMovement() && this.activity.getSource() !== 'user' && this.activity.getSource() !== 'character',
      touchAllowed: this.started && !this.disposed && !this.quiet && !this.menuOpen && this.character.isAutonomyEligible()
        && !requiresVitalSleep(this.options.getCharacterSnapshot()) && this.options.movement.canAcceptVoluntaryMovement()
        && this.activity.getSource() !== 'user' && this.activity.getSource() !== 'character',
      activeRunId: this.activity.getRuntime()?.runId ?? null, localSpeech: this.getCursorGamePresentation()?.speech != null };
  }
  public setQuietSupport(enabled: boolean): void {
    if (this.quietSupport === enabled) return;
    this.quietSupport = enabled;
    if (enabled) {
      this.socialFollowup.invalidate();
      this.providerAdmission.invalidateIncompatibleQuiet();
      this.blockUnsolicited();
      if (this.activity.getRuntime()?.activityId === 'zoomies' && this.activity.getSource() !== 'user') this.cancelActivity('explicit_cancel', true);
    }
    this.options.onPresentationChanged();
  }
  public getAutonomyMode(): { readonly quiet: boolean } { return { quiet: this.quiet }; }

  public setQuietMode(enabled: boolean): { readonly quiet: boolean } {
    if (this.quiet === enabled) return this.getAutonomyMode();
    this.quiet = enabled;
    this.systemIdle.reset();
    if (enabled) { this.socialFollowup.invalidate(); this.options.onAIInvalidated?.(); this.providerAdmission.invalidateIncompatibleQuiet(); }
    this.resetCursorInterest();
    if (enabled && (this.activity.isInitiative() || this.activity.getRuntime()?.activityId === 'zoomies')) {
      this.cancelActivity('explicit_cancel', true);
    }
    this.coordinator.notifyActivityFinished();
    this.options.onPresentationChanged();
    return this.getAutonomyMode();
  }

  private resetCursorInterest(): void {
    this.cursor.resetInterest(this.options.clock.now());
    this.gamePresentation.clear();
  }

  public setEnabled(enabled: boolean): void {
    this.systemIdle.setEnabled(enabled);
    this.resetCursorInterest();
    if (!enabled) { this.socialFollowup.invalidate(); this.options.onAIInvalidated?.(); this.providerAdmission.invalidate('disabled'); }
    if (!enabled) this.cancelActivity('explicit_cancel', true);
    this.enabled = enabled;
    this.coordinator.setEnabled(enabled);
  }

  public setMenuOpen(menuOpen: boolean): void {
    if (this.menuOpen !== menuOpen) this.systemIdle.reset();
    this.resetCursorInterest();
    if (menuOpen) { this.socialFollowup.invalidate(); this.options.onAIInvalidated?.(); this.providerAdmission.invalidate('disabled'); }
    if (menuOpen) this.cancelActivity('explicit_cancel', true);
    this.menuOpen = menuOpen;
    this.coordinator.setMenuOpen(menuOpen);
  }

  public getVisualEpisode(): BrainVisualEpisode {
    return { ...this.visuals.current, intent: { ...this.visuals.current.intent } };
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
    if (this.cursor.globalActive) return false;
    return this.observeCursor(screenPosition);
  }

  private pollCursor(nowMs: number): boolean {
    const changed = this.cursor.poll(nowMs, this.options.cursorPosition);
    if (changed === null) return false;
    if (this.cursor.globalActive && this.cursor.global !== null) this.observeCursor(this.cursor.global.globalPosition);
    if (changed) this.options.onPresentationChanged();
    return changed;
  }

  private observeCursor(screenPosition: Vector2Dto): boolean {
    if (!this.started || this.disposed) return false;
    const nowMs = this.options.clock.now();
    const playing = this.activity.getRuntime()?.activityId === 'cursor_interest';
    const compatible = playing || (
      this.providerAdmission.getOwnedRun() === null && !this.providerAdmission.hasPending() &&
      this.enabled &&
      !this.menuOpen &&
      !this.deferredUserInteractionResume &&
      (this.activity.getRuntime() === null ||
        (this.activity.getRuntime()?.activityId === 'calm' && this.activity.getSource() === 'local')) &&
      (this.visuals.current.intent.kind === 'idle_blink' || this.visuals.current.intent.kind === 'look_around') &&
      this.character.isAutonomyEligible() &&
      this.options.movement.canAcceptVoluntaryMovement());
    const proximity = this.cursor.observe(screenPosition, nowMs, this.options.movement.getRootPosition(), compatible);
    if (playing || !compatible || proximity.signal === undefined) return false;
    if (proximity.signal.distanceToRootWorldPx > DEFAULT_CURSOR_OBSERVE_CONSTRAINTS.ambientRadiusWorldPx) return false;

    const snapshot = this.options.getCharacterSnapshot();
    const budgetAvailable = !this.quiet && !this.quietSupport && !this.systemIdle.isBlocked() && this.initiativeBudget.available(nowMs);
    const gameCandidate = (this.options.cursorPosition === undefined || this.cursor.globalActive)
      && !this.cursor.mustExit && budgetAvailable && canPlayWithCursor(snapshot.needs, snapshot.synthesizedTone)
      ? createCursorInterestActivity({ root: this.options.movement.getRootPosition(), cursor: screenPosition,
          environment: this.options.movement.getEnvironmentSnapshot(), collisionInsets: this.options.movement.getCollisionInsets() })
      : null;
    // Keep observing until dwell matures; a gaze Activity here would reset it and consume cooldown.
    if (gameCandidate && proximity.state.withinSwatRange
        && proximity.state.dwellWithinSwatRangeMs < DEFAULT_CURSOR_REACTION_CONSTRAINTS.swatDwellMs) return false;
    const matureGameCandidate = gameCandidate !== null
      && proximity.state.dwellWithinSwatRangeMs >= DEFAULT_CURSOR_REACTION_CONSTRAINTS.swatDwellMs;
    const gameCandidateEligible = matureGameCandidate && this.activity.canStart(
      { kind: 'play', source: 'system', priority: 'normal', reason: 'cursor_observe' },
      { play: [gameCandidate] });
    const update = resolveCursorObserve({
      nowMs,
      signal: proximity.signal,
      needs: snapshot.needs,
      tone: snapshot.synthesizedTone,
      friendship: snapshot.relationship?.friendship ?? 0,
      gameCandidateEligible,
      learnedGamePreference: snapshot.learnedCursorGamePreference,
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

    let playCandidates = createCursorObserveActivityCandidates({
      zone: update.zone,
      needs: snapshot.needs,
      tone: snapshot.synthesizedTone,
      friendship: snapshot.relationship?.friendship ?? 0,
      gazeDirection: gazeDirectionTo(this.options.movement.getRootPosition(), screenPosition),
    });

    if (!budgetAvailable) playCandidates = playCandidates.filter(candidate => candidate.tags?.includes('gaze_only'));
    if (matureGameCandidate) {
      playCandidates = [gameCandidate];
    }
    this.coordinator.suspendForReactiveActivity();
    this.cursorReactionActive = true;
    if (this.activity.start(resolvedIntent, { play: playCandidates })) {
      if (this.activity.isInitiative()) this.initiativeBudget.start(nowMs);
      if (this.activity.getRuntime()?.activityId === 'cursor_interest') this.cursor.mustExit = true;
      this.cursorEpisode = { endsAtMs: nowMs + INITIATIVE_TUNING.cursorEpisodeMaxMs,
        supportId: this.options.movement.getEnvironmentSnapshot().currentSurface?.id };
      return true;
    }
    this.cursorReactionActive = false;
    this.coordinator.resumeAfterReactiveActivity();
    return false;
  }

  private expireCursorObservation(nowMs: number): void {
    if (!this.cursor.expire(nowMs, this.options.movement.getRootPosition())) return;
    if (this.cursorReactionActive && this.activity.getRuntime()?.activityId !== 'cursor_interest') this.cancelActivity('environment_invalidated', true);
  }

  public requestSleepWake(command: SleepWakeCommand): boolean {
    const intent = this.character.resolveDirectIntent(
      mapSleepWakeCommand(command),
      this.options.getCharacterSnapshot()
    ).resolvedIntent;
    if (intent === null) return false;
    this.suspendForUserInteraction();
    if (!this.options.movement.canAcceptVoluntaryMovement()) { this.resumeAfterUserInteraction(); return false; }
    if (command.action === 'sleep') {
      const started = this.activity.start(intent);
      this.resumeAfterUserInteraction();
      if (started) this.acceptUserContact();
      return started;
    }
    this.acceptUserContact();
    this.setVisualKind('wake_up', true, true);
    this.resumeAfterUserInteraction();
    return true;
  }

  public handleClick(): boolean {
    this.options.onAIInvalidated?.();
    const wasAwake = this.character.getSemanticSleepState() === 'awake';
    this.suspendForUserInteraction();
    if (!this.options.movement.canAcceptVoluntaryMovement()) { this.resumeAfterUserInteraction(); return true; }
    if (wasAwake) {
      this.acceptUserContact();
      this.setVisualKind('happy_reaction', true, true);
      this.resumeAfterUserInteraction();
      return true;
    }
    if (this.character.isAutonomyEligible()) {
      this.acceptUserContact();
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
    this.acceptUserContact();
    this.setVisualKind('wake_up', true, true);
    this.resumeAfterUserInteraction();
    return true;
  }

  public handleCharacterInteraction(type: BodyInteractionTypeDTO): boolean {
    if (type !== 'pet') this.options.onAIInvalidated?.();
    if (type !== 'click') {
      this.cancelActivity('user_interaction', true);
      if (!this.options.movement.canAcceptVoluntaryMovement()) return false;
    }
    if (type === 'click') return this.handleClick();
    if (type === 'double_click' || type === 'pet' || type === 'feed') {
      this.acceptUserContact();
      if (type === 'pet') this.options.onUserContact?.();
      this.setVisualKind('happy_reaction', true, true);
      return true;
    }
    if (type === 'think') {
      const intent = this.character.resolveDirectIntent(
        { kind: 'think', source: 'user', priority: 'normal', reason: 'user_think' },
        this.options.getCharacterSnapshot()
      ).resolvedIntent;
      if (intent === null) return false;
      const started = this.handleResolvedIntent(intent);
      if (started) this.acceptUserContact();
      return started;
    }
    if (type !== 'play') return false;
    const intent = this.character.resolveDirectIntent(
      { kind: 'play', source: 'user', priority: 'high', reason: 'user_play' },
      this.options.getCharacterSnapshot()
    ).resolvedIntent;
    const started = intent !== null && this.activity.start(intent);
    if (started) this.acceptUserContact();
    return started;
  }

  public beginDrag(): void {
    this.acceptUserContact();
    this.options.onAIInvalidated?.();
    this.cancelActivity('user_interaction', true, true);
    this.coordinator.noteUserActivity();
    this.coordinator.interruptForcedMotion();
    this.character.resolveDirectIntent(
      { kind: 'drag', source: 'user', priority: 'critical', reason: 'user_drag' },
      this.options.getCharacterSnapshot()
    );
  }

  public suspendForUserInteraction(): void {
    this.options.onAIInvalidated?.();
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
      this.coordinator.resumeAfterForcedMotion(
        event.outcome === 'crash_landing' ? LANDING_RECOVERY_MS.crash : LANDING_RECOVERY_MS.normal
      );
    }
  }

  public handleWindowSupportAttached(): void {
    // An autonomous route owns its landing; attaching must not cancel its continuation.
    if (this.activity.getRuntime() !== null) return;
    this.setVisualKind('land', true, true);
    this.coordinator.resumeAfterForcedMotion(LANDING_RECOVERY_MS.normal);
  }

  public handleSupportLost(): void {
    this.character.wakeForSupportLoss();
    this.cancelActivity('forced_motion', true);
    this.coordinator.interruptForcedMotion();
  }

  public beginDialogueThinking(_requestId: string): void {
    // Release the game without invalidating the newly admitted dialogue context.
    if (this.activity.getRuntime()?.activityId === 'cursor_interest') this.cancelActivity('explicit_cancel', true);
  }

  public endDialogueThinking(_requestId: string): void { this.dialoguePending = false; }

  public setBehaviorContext(context: BehaviorTurnContext | null): void { this.providerAdmission.setContext(context); }

  public offerDialogueIntent(offer: ProviderBehaviorOffer): BehaviorAdmissionReceipt {
    return this.providerAdmission.offer(offer);
  }

  public getAdmissionTrace() { return this.providerAdmission.getTrace(); }

  private providerGate(intent: BehaviorIntent): BehaviorAdmissionRejection | null {
    if (!this.started || this.disposed || !this.enabled || this.menuOpen) return 'disabled';
    if (['drag', 'land', 'wake', 'quiet'].includes(intent.kind)) return 'no_behavior_command';
    if (requiresVitalSleep(this.options.getCharacterSnapshot()) ||
        (!this.character.isAutonomyEligible() && this.activity.getRuntime()?.activityId !== 'rest_spot_nap')) return 'character_gate';
    if (!isQuietCompatible(intent, this.quiet || this.quietSupport)) return 'quiet';
    if (!this.options.movement.canAcceptVoluntaryMovement() && !this.activity.isTraversalStep()) return 'forced_motion';
    if (this.deferredUserInteractionResume || this.activity.getSource() === 'user') return 'user_conflict';
    if (!this.activity.canStart(intent)) return 'no_activity';
    return null;
  }

  public notifyTraversalRejected(request: Pick<TraversalRequest, 'runId' | 'stepId'>): void {
    const runtime = this.activity.getRuntime();
    if (runtime?.runId !== request.runId || runtime.currentStepId !== request.stepId) return;
    if (this.cancelActivity('environment_invalidated', true)) this.finishActivityCadence();
  }

  public notifyVoluntaryMovementCompleted(completed?: Pick<TraversalRequest, 'runId' | 'stepId'>): void {
    const previousRun = this.activity.getRuntime()?.runId;
    this.providerAdmission.tick();
    if (previousRun !== this.activity.getRuntime()?.runId) return;
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
    if ((this.activity.getRuntime() !== null || this.providerAdmission?.hasPending()) && intent.reason !== 'vital_sleep') return false;
    const social = intent.activityFamily === 'social_bid';
    if (!isQuietCompatible(intent, this.quiet || this.quietSupport)) return false;
    if (social && intent.source === 'timer' && !this.socialFollowup.canStartFirst()) return false;
    if (social && (this.systemIdle.isBlocked() || !this.initiativeBudget.available(this.options.clock.now()))) return false;
    this.startingSocial = social && intent.source === 'timer' ? 'first' : null;
    let started: boolean;
    try { started = this.activity.start(intent, social ? { play: [createSocialBidActivity(INITIATIVE_TUNING.socialWaitMaxMs)] } : undefined); } finally { this.startingSocial = null; }
    if (started) {
      if (social) { const run = this.activity.getRuntime(); if (run && intent.source !== 'system') this.options.onSocialBidStarted?.(run.runId, this.options.clock.now()); }
      this.localHistory.push({ kind: social ? 'social_bid' : intent.kind, atMs: this.options.clock.now() });
      if (intent.calmPose) this.localHistory.push({ kind: `calm:${intent.calmPose}`, atMs: this.options.clock.now() });
      if (this.localHistory.length > 16) this.localHistory.splice(0, this.localHistory.length - 16);
      return true;
    }
    if (intent.kind === 'wander') return false;
    if (intent.kind === 'sleep') { this.character.finishRest(); this.setVisualKind('idle_blink', true); return false; }
    this.setVisualIntent(
      mapBehaviorIntentToAnimationIntent(intent, this.options.getCharacterSnapshot().synthesizedTone),
      true,
      true
    );
    return true;
  }

  private blockUnsolicited(): void {
    this.socialFollowup.invalidate();
    this.options.onUnsolicitedBlocked?.();
    if (this.activity.isInitiative() && this.activity.getSource() !== 'user') this.cancelActivity('explicit_cancel', true);
    this.resetCursorInterest();
  }

  private drainSocialAdmission(): void {
    const returned = this.systemIdle.tick(!this.quiet && !this.quietSupport && !this.menuOpen);
    this.providerAdmission.tick();
    this.activity.tick(this.options.clock.now());
    if (returned) this.tryReturn();
    this.trySocialFollowup();
  }

  private trySocialFollowup(): boolean {
    const now = () => this.options.clock.now();
    const intent: BehaviorIntent = { kind: 'play', source: 'timer', priority: 'normal', activityFamily: 'social_bid' };
    const catalog = { play: [createSocialBidActivity(INITIATIVE_TUNING.socialWaitMaxMs, 'P4_autonomous', 'second')] };
    const continuous = () => this.started && !this.disposed && this.enabled && !this.quiet && !this.quietSupport
      && !this.menuOpen && this.systemIdle.isFreshActive() && this.character.isAutonomyEligible()
      && !requiresVitalSleep(this.options.getCharacterSnapshot()) && this.options.movement.canAcceptVoluntaryMovement();
    const eligible = () => continuous() && this.activity.getRuntime() === null && !this.dialoguePending
      && now() >= this.dialogueGuardUntilMs && !this.deferredUserInteractionResume
      && this.coordinator.canAcceptReactiveOpportunity() && !this.providerAdmission.hasPending()
      && this.providerAdmission.getOwnedRun() === null && this.initiativeBudget.available(now())
      && this.activity.canStart(intent, catalog);
    const ticket = this.socialFollowup.evaluate(now(), continuous(), eligible(), () => this.options.prng.next());
    if (!ticket) return false;
    const resolved = this.character.resolveDirectIntent(intent, this.options.getCharacterSnapshot()).resolvedIntent;
    if (!resolved || !this.socialFollowup.isCurrent(ticket, now()) || !eligible()) return false;
    this.startingSocial = ticket;
    try { return this.activity.start(resolved, catalog); } finally { this.startingSocial = null; }
  }

  private tryReturn(): boolean {
    const intent: BehaviorIntent = { kind: 'play', source: 'system', priority: 'normal', activityFamily: 'social_bid', reason: 'user_return' };
    const catalog = { play: [createSocialBidActivity(INITIATIVE_TUNING.socialWaitMaxMs, 'P3_reactive')] };
    const eligible = () => {
      const run = this.activity.getRuntime();
      return !this.systemIdle.isBlocked() && !this.quiet && !this.quietSupport && !this.menuOpen && this.enabled
        && this.coordinator.canAcceptReactiveOpportunity() && !this.deferredUserInteractionResume
        && !this.providerAdmission.hasPending() && this.providerAdmission.getOwnedRun() === null
        && (run === null || (run.activityId === 'calm' && this.activity.getSource() === 'local'))
        && ['idle_blink', 'look_around'].includes(this.visuals.current.intent.kind)
        && !requiresVitalSleep(this.options.getCharacterSnapshot()) && this.options.movement.canAcceptVoluntaryMovement()
        && this.initiativeBudget.available(this.options.clock.now()) && this.activity.canStart(intent, catalog);
    };
    if (!eligible()) return false;
    const resolved = this.character.resolveDirectIntent(intent, this.options.getCharacterSnapshot()).resolvedIntent;
    if (!resolved) return false;
    this.cancelActivity('higher_priority_activity', false);
    if (!eligible()) return false;
    this.coordinator.suspendForReactiveActivity();
    if (!this.activity.start(resolved, catalog)) { this.coordinator.resumeAfterReactiveActivity(); return false; }
    this.initiativeBudget.start(this.options.clock.now());
    return true;
  }

  private finishActivityCadence(): void {
    this.coordinator.resumeAfterReactiveActivity();
    if (this.deferredUserInteractionResume) {
      this.deferredUserInteractionResume = false;
      this.coordinator.resumeAfterUserInteraction();
    } else {
      this.coordinator.notifyActivityFinished();
    }
  }

  private cancelActivity(reason: ActivityCancelReason, publish: boolean, forDrag = false): boolean {
    if (reason === 'user_interaction' || reason === 'forced_motion') {
      this.socialFollowup.invalidate();
      this.providerAdmission?.invalidate(reason);
    }

    this.gamePresentation.clear();
    this.jumpFallAtMs = null;
    this.cursorEpisode = null;
    const wasCursorReaction = this.cursorReactionActive;
    const restSpot = this.activity.getRuntime()?.activityId.startsWith('rest_spot_') ?? false;
    const cancelled = this.activity.cancel(reason, forDrag);
    this.gamePresentation.clear();
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
    if (this.visuals.set(kind, replay) && publish) this.options.onPresentationChanged();
  }

  private setVisualIntent(intent: AnimationIntent<BrainVisualIntentKindDTO>, publish: boolean, replay: boolean): void {
    if (this.visuals.set(intent, replay) && publish) this.options.onPresentationChanged();
  }

  private resetBrainLoop(): void {
    this.cursor.resetPolling();
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
