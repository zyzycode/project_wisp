import {
  AutonomyCoordinator,
  type AutonomyClock,
  type AutonomyScheduler,
  type AutonomyTraceEntry,
  type VoluntaryMovementController,
} from '../application/services/autonomy-coordinator';
import type { BehaviorConfig, IPrng } from '../domain/behavior/autonomous-behavior';
import type { BehaviorIntent } from '../domain/behavior/behavior-intent';
import type { MotionEvent } from '../domain/behavior/motion-engine';
import type { Vector2Dto } from '../domain/behavior/motion-engine';
import { AutonomyCharacterEngine, type CharacterAutonomySnapshot } from '../domain/character';
import {
  mapSleepWakeCommand,
  type SleepWakeCommand,
} from '../application/services/sleep-wake-command-mapper';
import type {
  AnimationLifecycleResultDTO,
  PetAnimationStateDTO,
} from '../shared/ipc-contracts';

const ANIMATION_LIFECYCLE_WATCHDOG_MS = 15_000;

type PendingAnimationContext = 'sleep_start' | 'wake_up' | 'landing';

interface PendingAnimationLifecycle {
  readonly requestId: string;
  readonly context: PendingAnimationContext;
}

export interface MainAutonomyCompositionOptions {
  readonly clock: AutonomyClock;
  readonly scheduler: AutonomyScheduler;
  readonly prng: IPrng;
  readonly prngMetadata: { readonly algorithm: string; readonly seed: number };
  readonly getCharacterSnapshot: () => CharacterAutonomySnapshot;
  readonly movement: VoluntaryMovementController;
  readonly requestManualRootPosition: (targetRootPosition: Vector2Dto) => boolean;
  readonly behaviorConfig?: BehaviorConfig;
  readonly createAnimationRequestId: () => string;
  readonly onPresentationChanged: () => void;
}

/** Actual Main composition boundary for Character, cadence, and presentation hand-offs. */
export class MainAutonomyComposition {
  private readonly character = new AutonomyCharacterEngine();
  private readonly coordinator: AutonomyCoordinator;
  private animationState: PetAnimationStateDTO = 'idle';
  private pendingAnimation: PendingAnimationLifecycle | undefined;
  private animationWatchdogHandle: unknown;

  public constructor(private readonly options: MainAutonomyCompositionOptions) {
    this.coordinator = new AutonomyCoordinator({
      clock: options.clock,
      scheduler: options.scheduler,
      prng: options.prng,
      prngMetadata: options.prngMetadata,
      character: this.character,
      getCharacterSnapshot: options.getCharacterSnapshot,
      movement: options.movement,
      onIntentResolved: (intent) => this.handleResolvedIntent(intent),
      onMovementStopped: () => {
        if (this.pendingAnimation === undefined) this.setAnimationState('idle', true);
      },
      ...(options.behaviorConfig === undefined ? {} : { behaviorConfig: options.behaviorConfig }),
    });
  }

  public start(): void { this.coordinator.start(); }
  public stop(): void {
    this.invalidatePendingAnimation();
    this.coordinator.stop();
  }
  public dispose(): void {
    this.invalidatePendingAnimation();
    this.coordinator.dispose();
  }
  public setEnabled(enabled: boolean): void { this.coordinator.setEnabled(enabled); }
  public setMenuOpen(menuOpen: boolean): void { this.coordinator.setMenuOpen(menuOpen); }
  public getAnimationState(): PetAnimationStateDTO { return this.animationState; }
  public getAnimationRequestId(): string | undefined {
    return this.pendingAnimation?.requestId;
  }
  public getDecisionTrace(): readonly AutonomyTraceEntry[] { return this.coordinator.getDecisionTrace(); }

  public requestSleepWake(command: SleepWakeCommand): boolean {
    const resolution = this.character.resolveDirectIntent(
      mapSleepWakeCommand(command),
      this.options.getCharacterSnapshot()
    );
    if (resolution.resolvedIntent === null) return false;
    this.coordinator.suspendForUserInteraction();
    if (command.action === 'sleep') {
      this.beginAnimationLifecycle('sleep_start', 'sleep_start');
    } else {
      this.beginAnimationLifecycle('wake_up', 'wake_up');
    }
    return true;
  }

  public handleClick(): boolean {
    const resolution = this.character.resolveDirectIntent(
      { kind: 'wake', source: 'user', priority: 'critical', reason: 'user_click_wake' },
      this.options.getCharacterSnapshot()
    );
    if (resolution.resolvedIntent === null) return false;
    this.coordinator.suspendForUserInteraction();
    this.beginAnimationLifecycle('wake_up', 'wake_up');
    return true;
  }

  public beginDrag(): void {
    this.invalidatePendingAnimation();
    this.coordinator.interruptForcedMotion();
    this.character.resolveDirectIntent(
      { kind: 'drag', source: 'user', priority: 'critical', reason: 'user_drag' },
      this.options.getCharacterSnapshot()
    );
    this.setAnimationState('idle', false);
  }

  public suspendForUserInteraction(): void {
    this.invalidatePendingAnimation();
    this.coordinator.suspendForUserInteraction();
  }
  public resumeAfterUserInteraction(): void { this.coordinator.resumeAfterUserInteraction(); }

  public requestManualRootPosition(targetRootPosition: Vector2Dto): boolean {
    this.coordinator.suspendForManualMovement();
    const accepted = this.options.requestManualRootPosition(targetRootPosition);
    if (!accepted) this.coordinator.resumeAfterManualMovement();
    return accepted;
  }

  public handleMotionEvent(event: MotionEvent): void {
    if (event.type === 'drag_started' || event.type === 'airborne_started') {
      this.invalidatePendingAnimation();
      this.coordinator.interruptForcedMotion();
      return;
    }
    if (event.type === 'landed') {
      this.beginAnimationLifecycle('land', 'landing');
    }
  }

  public handleSupportLost(): void {
    this.invalidatePendingAnimation();
    this.coordinator.interruptForcedMotion();
  }

  public handleAnimationLifecycleResult(result: AnimationLifecycleResultDTO): boolean {
    const pending = this.pendingAnimation;
    if (pending === undefined || pending.requestId !== result.requestId) return false;
    this.pendingAnimation = undefined;
    this.clearAnimationWatchdog();
    if (result.outcome !== 'interrupted') this.continueAfterAnimation(pending.context);
    return true;
  }

  public notifyVoluntaryMovementCompleted(): void {
    if (this.pendingAnimation === undefined) this.setAnimationState('idle', false);
    this.coordinator.notifyVoluntaryMovementCompleted();
  }

  private setAnimationState(state: PetAnimationStateDTO, publish: boolean): void {
    this.animationState = state;
    if (publish) this.options.onPresentationChanged();
  }

  private handleResolvedIntent(intent: BehaviorIntent): void {
    if (intent.kind === 'sleep') {
      this.beginAnimationLifecycle('sleep_start', 'sleep_start');
      return;
    }
    this.setAnimationState(intent.kind === 'wander' ? 'walk' : 'idle', true);
  }

  private beginAnimationLifecycle(
    animationState: PetAnimationStateDTO,
    context: PendingAnimationContext
  ): void {
    this.invalidatePendingAnimation();
    const requestId = this.options.createAnimationRequestId();
    if (requestId.trim().length === 0 || requestId.length > 128) {
      throw new Error('Animation request ID must be a non-empty bounded string');
    }
    this.pendingAnimation = { requestId, context };
    this.animationState = animationState;
    this.animationWatchdogHandle = this.options.scheduler.setTimeout(() => {
      if (this.pendingAnimation?.requestId !== requestId) return;
      const timedOut = this.pendingAnimation;
      this.pendingAnimation = undefined;
      this.animationWatchdogHandle = undefined;
      this.continueAfterAnimation(timedOut.context);
    }, ANIMATION_LIFECYCLE_WATCHDOG_MS);
    this.options.onPresentationChanged();
  }

  private continueAfterAnimation(context: PendingAnimationContext): void {
    if (context === 'sleep_start') {
      this.setAnimationState('sleep_loop', true);
      return;
    }
    if (context === 'landing') {
      this.setAnimationState('settle', true);
      this.coordinator.resumeAfterForcedMotion();
      return;
    }
    this.setAnimationState('idle', true);
    this.coordinator.resumeAfterUserInteraction();
  }

  private invalidatePendingAnimation(): void {
    this.pendingAnimation = undefined;
    this.clearAnimationWatchdog();
  }

  private clearAnimationWatchdog(): void {
    if (this.animationWatchdogHandle === undefined) return;
    this.options.scheduler.clearTimeout(this.animationWatchdogHandle);
    this.animationWatchdogHandle = undefined;
  }
}
