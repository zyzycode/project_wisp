import type {
  CharacterAutonomyResolution,
  CharacterAutonomySnapshot,
} from '../../domain/character/autonomy-character-engine';
import type { CollisionInsets, ScreenBoundsDto, Vector2Dto } from '../../domain/behavior/motion-engine';
import {
  calculateNextWanderTarget,
  DEFAULT_AUTONOMOUS_INTENT_CONFIG,
  DEFAULT_BEHAVIOR_CONFIG,
  type AutonomousCandidate,
  type AutonomousDecisionContext,
  type BehaviorConfig,
  type IPrng,
} from '../../domain/behavior/autonomous-behavior';
import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';

export interface AutonomyClock {
  now(): number;
}

export interface AutonomyScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CharacterAutonomyBoundary {
  isAutonomyEligible(): boolean;
  resolveAutonomousOpportunity(input: {
    readonly context: AutonomousDecisionContext;
    readonly snapshot: CharacterAutonomySnapshot;
    readonly candidates: readonly AutonomousCandidate[];
    readonly prng: IPrng;
    readonly config: typeof DEFAULT_AUTONOMOUS_INTENT_CONFIG;
  }): CharacterAutonomyResolution;
}

export interface VoluntaryMovementController {
  getRootPosition(): Vector2Dto;
  getBounds(): ScreenBoundsDto;
  getCollisionInsets(): CollisionInsets;
  canAcceptVoluntaryMovement(): boolean;
  requestVoluntaryMovement(command: {
    readonly kind: 'horizontal_wander';
    readonly targetRootPosition: Vector2Dto;
    readonly speedPxPerSec: number;
  }): boolean;
  cancelVoluntaryMovement(): boolean;
}

export interface AutonomyTraceEntry {
  readonly decisionSequence: number;
  readonly opportunityAtMs: number;
  readonly orderedCandidateKinds: readonly AutonomousCandidate['kind'][];
  readonly outcomeKind: BehaviorIntent['kind'] | null;
  readonly outcomeReason: string;
  readonly prng: { readonly algorithm: string; readonly seed: number };
}

export interface AutonomyCoordinatorOptions {
  readonly clock: AutonomyClock;
  readonly scheduler: AutonomyScheduler;
  readonly prng: IPrng;
  readonly prngMetadata: { readonly algorithm: string; readonly seed: number };
  readonly character: CharacterAutonomyBoundary;
  readonly getCharacterSnapshot: () => CharacterAutonomySnapshot;
  readonly movement: VoluntaryMovementController;
  readonly onIntentResolved: (
    intent: BehaviorIntent,
    opportunity: { readonly decisionSequence: number; readonly opportunityAtMs: number }
  ) => void;
  readonly onMovementStopped?: () => void;
  readonly behaviorConfig?: BehaviorConfig;
  readonly traceCapacity?: number;
}

function candidateSet(): readonly AutonomousCandidate[] {
  return Object.freeze([
    Object.freeze({ kind: 'idle', source: 'timer', priority: 'low', reason: 'autonomous_idle' }),
    Object.freeze({ kind: 'wander', source: 'timer', priority: 'normal', reason: 'autonomous_wander' }),
    Object.freeze({ kind: 'sleep', source: 'timer', priority: 'high', moodHint: 'sleepy', reason: 'autonomous_nap' }),
  ] satisfies AutonomousCandidate[]);
}

/** Single Application cadence/lifecycle owner; semantic state remains in Character. */
export class AutonomyCoordinator {
  private timerHandle: unknown;
  private started = false;
  private enabled = true;
  private menuOpen = false;
  private readonly operationalSuspensions = new Set<
    'user_interaction' | 'manual_movement' | 'forced_motion'
  >();
  private disposed = false;
  private generation = 0;
  private decisionSequence = 0;
  private lastOpportunityAtMs = Number.NEGATIVE_INFINITY;
  private readonly trace: AutonomyTraceEntry[] = [];

  public constructor(private readonly options: AutonomyCoordinatorOptions) {}

  public start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.scheduleNextOpportunity();
  }

  public stop(): void {
    if (
      !this.started &&
      this.timerHandle === undefined &&
      this.operationalSuspensions.size === 0
    ) return;
    this.started = false;
    this.operationalSuspensions.clear();
    this.cancelPendingWork(true);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.started = false;
    this.operationalSuspensions.clear();
    this.cancelPendingWork(true);
  }

  public setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return;
    this.enabled = enabled;
    this.cancelPendingWork(true);
    if (enabled) this.scheduleNextOpportunity();
  }

  public setMenuOpen(menuOpen: boolean): void {
    if (this.disposed || this.menuOpen === menuOpen) return;
    this.menuOpen = menuOpen;
    this.cancelPendingWork(true);
    if (!menuOpen) this.scheduleNextOpportunity();
  }

  public suspendForUserInteraction(): void {
    if (this.disposed) return;
    this.cancelPendingWork(true);
    this.operationalSuspensions.add('user_interaction');
  }

  public resumeAfterUserInteraction(): void {
    if (!this.operationalSuspensions.delete('user_interaction')) return;
    this.scheduleNextOpportunity();
  }

  public interruptForcedMotion(): void {
    if (this.disposed) return;
    this.cancelPendingWork(true);
    this.operationalSuspensions.delete('user_interaction');
    this.operationalSuspensions.add('forced_motion');
  }

  public resumeAfterForcedMotion(): void {
    if (!this.operationalSuspensions.delete('forced_motion')) return;
    this.scheduleNextOpportunity();
  }

  public suspendForManualMovement(): void {
    if (this.disposed) return;
    this.cancelPendingWork(true);
    this.operationalSuspensions.add('manual_movement');
  }

  public resumeAfterManualMovement(): void {
    if (!this.operationalSuspensions.delete('manual_movement')) return;
    this.scheduleNextOpportunity();
  }

  public notifyVoluntaryMovementCompleted(): void {
    if (this.disposed) return;
    if (this.operationalSuspensions.has('manual_movement')) {
      this.resumeAfterManualMovement();
    } else {
      this.scheduleNextOpportunity();
    }
  }

  public getDecisionTrace(): readonly AutonomyTraceEntry[] {
    return this.trace.map((entry) => ({
      ...entry,
      orderedCandidateKinds: [...entry.orderedCandidateKinds],
      prng: { ...entry.prng },
    }));
  }

  private scheduleNextOpportunity(): void {
    this.clearTimer();
    if (!this.isCadenceEligible()) return;
    const config = this.behaviorConfig();
    const rangeMs = Math.max(0, config.maxIdleDurationMs - config.minIdleDurationMs);
    const delayMs = config.minIdleDurationMs + this.nextRandom() * rangeMs;
    const scheduledGeneration = this.generation;
    this.timerHandle = this.options.scheduler.setTimeout(() => {
      this.timerHandle = undefined;
      if (scheduledGeneration !== this.generation || !this.isCadenceEligible()) return;
      this.runOpportunity();
    }, Math.max(0, delayMs));
  }

  private runOpportunity(): void {
    if (!this.options.movement.canAcceptVoluntaryMovement()) {
      this.recordTrace(null, 'movement_unavailable');
      this.scheduleNextOpportunity();
      return;
    }

    const observedAtMs = this.options.clock.now();
    const opportunityAtMs = Math.max(observedAtMs, this.lastOpportunityAtMs + 0.001);
    this.lastOpportunityAtMs = opportunityAtMs;
    const decisionSequence = ++this.decisionSequence;
    const candidates = candidateSet();
    const snapshot = this.options.getCharacterSnapshot();
    const resolution = this.options.character.resolveAutonomousOpportunity({
      context: {
        decisionSequence,
        opportunityAtMs,
        tone: snapshot.synthesizedTone,
        idleElapsedMs: this.behaviorConfig().minIdleDurationMs,
      },
      snapshot,
      candidates,
      prng: this.options.prng,
      config: {
        ...DEFAULT_AUTONOMOUS_INTENT_CONFIG,
        behavior: this.behaviorConfig(),
      },
    });
    const resolved = resolution.resolvedIntent;
    this.pushTrace({
      decisionSequence,
      opportunityAtMs,
      orderedCandidateKinds: candidates.map((candidate) => candidate.kind),
      outcomeKind: resolved?.kind ?? null,
      outcomeReason: resolved?.reason ?? 'no_candidate_accepted',
      prng: { ...this.options.prngMetadata },
    });

    if (resolved === null) {
      this.scheduleNextOpportunity();
      return;
    }

    if (resolved.kind === 'wander') {
      const accepted = this.requestWander();
      if (accepted) {
        this.options.onIntentResolved(resolved, { decisionSequence, opportunityAtMs });
      } else {
        this.amendLatestTraceReason('movement_command_rejected');
        this.options.onMovementStopped?.();
        this.scheduleNextOpportunity();
      }
      return;
    }
    this.options.onIntentResolved(resolved, { decisionSequence, opportunityAtMs });
    this.scheduleNextOpportunity();
  }

  private requestWander(): boolean {
    const start = this.options.movement.getRootPosition();
    const target = calculateNextWanderTarget(
      start,
      this.options.movement.getBounds(),
      this.options.prng,
      this.options.movement.getCollisionInsets(),
      this.behaviorConfig()
    );
    const accepted = target.durationMs > 0 && this.options.movement.requestVoluntaryMovement({
      kind: 'horizontal_wander',
      targetRootPosition: target.target,
      speedPxPerSec: this.behaviorConfig().wanderSpeedPxPerSec,
    });
    return accepted;
  }

  private cancelPendingWork(cancelMovement: boolean): void {
    this.generation += 1;
    this.clearTimer();
    if (cancelMovement && this.options.movement.cancelVoluntaryMovement()) {
      this.operationalSuspensions.delete('manual_movement');
      this.options.onMovementStopped?.();
    }
  }

  private clearTimer(): void {
    if (this.timerHandle === undefined) return;
    this.options.scheduler.clearTimeout(this.timerHandle);
    this.timerHandle = undefined;
  }

  private isCadenceEligible(): boolean {
    return (
      this.started &&
      this.enabled &&
      !this.menuOpen &&
      this.operationalSuspensions.size === 0 &&
      !this.disposed &&
      this.options.character.isAutonomyEligible()
    );
  }

  private recordTrace(outcomeKind: BehaviorIntent['kind'] | null, outcomeReason: string): void {
    const observedAtMs = this.options.clock.now();
    const opportunityAtMs = Math.max(observedAtMs, this.lastOpportunityAtMs + 0.001);
    this.lastOpportunityAtMs = opportunityAtMs;
    const decisionSequence = ++this.decisionSequence;
    this.pushTrace({
      decisionSequence,
      opportunityAtMs,
      orderedCandidateKinds: candidateSet().map((candidate) => candidate.kind),
      outcomeKind,
      outcomeReason,
      prng: { ...this.options.prngMetadata },
    });
  }

  private pushTrace(entry: AutonomyTraceEntry): void {
    this.trace.push(Object.freeze(entry));
    const capacity = Math.max(1, Math.floor(this.options.traceCapacity ?? 32));
    if (this.trace.length > capacity) this.trace.splice(0, this.trace.length - capacity);
  }

  private amendLatestTraceReason(outcomeReason: string): void {
    const index = this.trace.length - 1;
    const current = this.trace[index];
    if (current !== undefined) this.trace[index] = Object.freeze({ ...current, outcomeReason });
  }

  private behaviorConfig(): BehaviorConfig {
    return this.options.behaviorConfig ?? DEFAULT_BEHAVIOR_CONFIG;
  }

  private nextRandom(): number {
    const value = this.options.prng.next();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('IPrng.next() must return a finite value in [0, 1)');
    }
    return value;
  }
}
