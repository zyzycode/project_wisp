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
  createSystemAnimationIntent,
  mapBehaviorIntentToAnimationIntent,
  type AnimationIntent,
} from '../domain/animation/animation-intent';
import {
  mapSleepWakeCommand,
  type SleepWakeCommand,
} from '../application/services/sleep-wake-command-mapper';
import type {
  BrainVisualIntentKindDTO,
  CharacterInteractionTypeDTO,
} from '../shared/ipc-contracts';

export interface BrainVisualEpisode {
  readonly id: string;
  readonly startedAtMs: number;
  readonly intent: AnimationIntent<BrainVisualIntentKindDTO>;
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
  readonly createVisualEpisodeId: () => string;
  readonly onPresentationChanged: () => void;
}

/** Actual Main composition boundary for Character, cadence, and presentation hand-offs. */
export class MainAutonomyComposition {
  private readonly character = new AutonomyCharacterEngine();
  private readonly coordinator: AutonomyCoordinator;
  private readonly usedVisualEpisodeIds = new Set<string>();
  private visualEpisode: BrainVisualEpisode;

  public constructor(private readonly options: MainAutonomyCompositionOptions) {
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
      onMovementStopped: () => {
        this.setVisualKind('idle_blink', true);
      },
      ...(options.behaviorConfig === undefined ? {} : { behaviorConfig: options.behaviorConfig }),
    });
  }

  public start(): void { this.coordinator.start(); }
  public stop(): void { this.coordinator.stop(); }
  public dispose(): void { this.coordinator.dispose(); }
  public setEnabled(enabled: boolean): void { this.coordinator.setEnabled(enabled); }
  public setMenuOpen(menuOpen: boolean): void { this.coordinator.setMenuOpen(menuOpen); }
  public getVisualEpisode(): BrainVisualEpisode {
    return {
      ...this.visualEpisode,
      intent: { ...this.visualEpisode.intent },
    };
  }
  public getDecisionTrace(): readonly AutonomyTraceEntry[] { return this.coordinator.getDecisionTrace(); }

  public requestSleepWake(command: SleepWakeCommand): boolean {
    const resolution = this.character.resolveDirectIntent(
      mapSleepWakeCommand(command),
      this.options.getCharacterSnapshot()
    );
    if (resolution.resolvedIntent === null) return false;
    this.coordinator.suspendForUserInteraction();
    this.setVisualKind(command.action === 'sleep' ? 'sleep_start' : 'wake_up', true, true);
    if (command.action === 'wake') this.coordinator.resumeAfterUserInteraction();
    return true;
  }

  public handleClick(): boolean {
    if (this.character.getSemanticSleepState() === 'awake') {
      this.setVisualKind('happy_reaction', true, true);
      return true;
    }
    const resolution = this.character.resolveDirectIntent(
      { kind: 'wake', source: 'user', priority: 'critical', reason: 'user_click_wake' },
      this.options.getCharacterSnapshot()
    );
    if (resolution.resolvedIntent === null) return false;
    this.coordinator.suspendForUserInteraction();
    this.setVisualKind('wake_up', true, true);
    this.coordinator.resumeAfterUserInteraction();
    return true;
  }

  public handleCharacterInteraction(type: CharacterInteractionTypeDTO): boolean {
    if (type === 'click') return this.handleClick();
    if (type === 'double_click' || type === 'pet' || type === 'feed') {
      this.setVisualKind('happy_reaction', true, true);
      return true;
    }
    if (type === 'play') {
      this.setVisualKind('run', true, true);
      return true;
    }
    return false;
  }

  public beginDrag(): void {
    this.coordinator.interruptForcedMotion();
    this.character.resolveDirectIntent(
      { kind: 'drag', source: 'user', priority: 'critical', reason: 'user_drag' },
      this.options.getCharacterSnapshot()
    );
  }

  public suspendForUserInteraction(): void {
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
    if (event.type === 'drag_started') {
      this.coordinator.interruptForcedMotion();
      this.setVisualKind('dragged', true, true);
      return;
    }
    if (event.type === 'airborne_started') {
      this.coordinator.interruptForcedMotion();
      this.setVisualKind('fall', true, true);
      return;
    }
    if (event.type === 'landed') {
      this.setVisualKind('land', true, true);
      this.coordinator.resumeAfterForcedMotion();
    }
  }

  public handleSupportLost(): void {
    this.coordinator.interruptForcedMotion();
  }

  public notifyVoluntaryMovementCompleted(): void {
    this.setVisualKind('idle_blink', false);
    this.coordinator.notifyVoluntaryMovementCompleted();
  }

  private handleResolvedIntent(intent: BehaviorIntent): void {
    const animationIntent = mapBehaviorIntentToAnimationIntent(
      intent,
      this.options.getCharacterSnapshot().synthesizedTone
    );
    this.setVisualIntent(animationIntent, true, true);
  }

  private setVisualKind(
    kind: BrainVisualIntentKindDTO,
    publish: boolean,
    replay = false
  ): void {
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
    if (id.trim().length === 0 || id.trim() !== id || id.length > 128) {
      throw new Error('Visual episode ID must be a trimmed non-empty bounded string');
    }
    if (this.usedVisualEpisodeIds.has(id)) {
      throw new Error('Visual episode ID must be unique within the Brain runtime');
    }
    this.usedVisualEpisodeIds.add(id);
    const intent = typeof source === 'string'
      ? createSystemAnimationIntent(
          source,
          this.options.getCharacterSnapshot().synthesizedTone
        )
      : source;
    return {
      id,
      startedAtMs: this.options.clock.now(),
      intent: { ...intent },
    };
  }
}
