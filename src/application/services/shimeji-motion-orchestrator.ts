import type { ExternalWindowSurfacesPort, ExternalWindowSurfacesSnapshot } from '../ports/external-window-surfaces.port';
import { isExternalSurface, isFreshExternalObservation, selectWindowTopForRelease } from '../../domain/behavior/external-surface-support';
import { SCREEN_CLIMB_SPEED, type TraversalRequest } from '../../domain/behavior/traversal-route';
import type { PetPositionPort } from '../ports/pet-position-port';
import {
  calculateRootCollisionRange,
  clampRootPosition,
  DEFAULT_MOTION_CONSTRAINTS,
  type IMotionEngine,
  type MotionConstraints,
  type MotionEvent,
  type MotionState,
  type PointerMotionSample,
  type Vector2Dto,
} from '../../domain/behavior/motion-engine';
import type { PetPositionService } from './pet-position.service';
import {
  SurfaceKinematics,
  type EnvironmentSnapshot,
  type ExternalWindowSurface,
  type SurfaceKinematicsEvent,
  type SurfaceKinematicsState,
} from '../../domain/behavior/surface-kinematics';
import type {
  IShimejiStimulusMapper,
  ShimejiFeedbackEvent,
  StimulusDto,
} from '../ports/shimeji-feedback-port';

export type {
  IShimejiStimulusMapper,
  ShimejiFeedbackEvent,
  ShimejiStimulusMappingContext,
  StimulusDto,
} from '../ports/shimeji-feedback-port';

export const DEFAULT_DRAG_HOLD_THRESHOLD_MS = 500;

export interface PointerInput {
  readonly pointerId: number;
  readonly sequence: number;
  readonly screenPosition: Vector2Dto;
}

export interface DragPointerInput extends PointerInput {
  readonly dragSessionId: string;
}

export interface ShimejiMotionEventDispatcher {
  dispatchMotionEvent(event: MotionEvent): void;
  dispatchSurfaceEvent(event: SurfaceKinematicsEvent): void;
}

export interface ShimejiMotionScheduler {
  schedule(callback: () => void): () => void;
}

export interface ShimejiMotionOrchestratorOptions {
  readonly initialMotion: MotionState;
  readonly initialSurface: SurfaceKinematicsState;
  readonly motionEngine: IMotionEngine;
  readonly surfaceKinematics: SurfaceKinematics;
  readonly environment: (position?: Vector2Dto) => EnvironmentSnapshot;
  readonly externalWindows?: ExternalWindowSurfacesPort;
  readonly positionPort: PetPositionPort;
  readonly positionService?: PetPositionService;
  readonly now: () => number;
  readonly scheduler?: ShimejiMotionScheduler;
  readonly constraints?: Pick<MotionConstraints, 'fixedStepSec' | 'maxFrameDeltaSec' | 'stumbleMaxSeverity' | 'throwSampling' | 'collisionInsets'>;
  readonly eventDispatcher?: ShimejiMotionEventDispatcher;
  readonly stimulusMapper?: IShimejiStimulusMapper;
  readonly applyStimulus?: (stimulus: StimulusDto) => void;
  readonly createStimulusTimestamp?: () => string;
  readonly dragHoldThresholdMs?: number;
  readonly createDragSessionId?: () => string;
  readonly onTraversalRejected?: (request: TraversalRequest) => void;
  readonly onVoluntaryMovementCompleted?: (completed?: Pick<TraversalRequest, 'runId' | 'stepId'>) => void;
}

export type VoluntaryRootCommand =
  | {
      readonly kind: 'horizontal_wander';
      readonly targetRootPosition: Vector2Dto;
      readonly speedPxPerSec: number;
    }
  | {
      readonly kind: 'manual_root';
      readonly targetRootPosition: Vector2Dto;
    };

interface DragSession {
  readonly id: string;
  readonly pointerId: number;
  readonly grabOffset: Vector2Dto;
  readonly startedAtMs: number;
  lastSequence: number;
  lastAppliedSequence: number;
  holdFeedbackEmitted: boolean;
  samples: PointerMotionSample[];
}

type QueuedPointerEvent =
  | { readonly type: 'begin'; readonly input: PointerInput; readonly sessionId: string; readonly receivedAtMs: number }
  | { readonly type: 'move'; readonly input: DragPointerInput; readonly receivedAtMs: number }
  | { readonly type: 'release'; readonly input: DragPointerInput; readonly receivedAtMs: number };

function isFiniteVector(value: Vector2Dto): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isValidPointerInput(input: PointerInput): boolean {
  return (
    Number.isInteger(input.pointerId) &&
    input.pointerId >= 0 &&
    Number.isInteger(input.sequence) &&
    input.sequence >= 0 &&
    isFiniteVector(input.screenPosition)
  );
}

function groundedSurface(nowMs: number): SurfaceKinematicsState {
  return { phase: 'grounded', updatedAtMs: nowMs, locomotionVelocityPxPerSec: { x: 0, y: 0 } };
}

/**
 * Application owner of the fixed-step Shimeji movement transaction.
 * It deliberately has no Electron, DOM, Node timer, or renderer dependency.
 */
export class ShimejiMotionOrchestrator {
  private motion: MotionState;
  private surface: SurfaceKinematicsState;
  private accumulatorSec = 0;
  private dragSession: DragSession | undefined;
  private lastTickAtMs: number | undefined;
  private simulationAtMs: number | undefined;
  private presentationRevision = 0;
  private readonly queuedPointerEvents: QueuedPointerEvent[] = [];
  private readonly emittedStimulusIds = new Set<string>();
  private cancelScheduledTick: (() => void) | undefined;
  private running = false;
  private generatedSessionCount = 0;
  private voluntaryCommand: VoluntaryRootCommand | undefined;
  private presentationDirty = false;
  private traversal: TraversalRequest | undefined;
  private traversalStarted = false;
  private attachmentRunId: string | undefined;
  private completedTraversal: TraversalRequest | undefined;
  private externalSnapshot: ExternalWindowSurfacesSnapshot | undefined;
  private selectedExternalId: string | undefined;
  private externalWalkTarget: number | undefined;

  public constructor(private readonly options: ShimejiMotionOrchestratorOptions) {
    if (options.stimulusMapper !== undefined && options.createStimulusTimestamp === undefined) {
      throw new Error('A stimulus timestamp source is required with the stimulus mapper');
    }
    if (!Number.isFinite(this.dragHoldThresholdMs()) || this.dragHoldThresholdMs() < 0) {
      throw new RangeError('Drag hold threshold must be finite and non-negative');
    }
    this.motion = options.initialMotion;
    this.surface = options.initialSurface;
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    const nowMs = this.options.now();
    this.lastTickAtMs = nowMs;
    this.simulationAtMs = nowMs;
    this.surface = { ...this.surface, updatedAtMs: nowMs };
    this.scheduleNextTick();
  }

  public stop(): void {
    this.running = false;
    this.cancelVoluntaryMovement();
    this.cancelScheduledTick?.();
    this.cancelScheduledTick = undefined;
  }

  public beginDrag(input: PointerInput): string | null {
    if (!isValidPointerInput(input) || this.dragSession !== undefined || this.hasQueuedBegin()) return null;
    this.cancelVoluntaryMovement(true);
    const sessionId = this.options.createDragSessionId?.() ?? `drag-${++this.generatedSessionCount}`;
    const nowMs = this.options.now();
    this.dragSession = {
      id: sessionId,
      pointerId: input.pointerId,
      grabOffset: {
        x: this.motion.position.x - input.screenPosition.x,
        y: this.motion.position.y - input.screenPosition.y,
      },
      startedAtMs: nowMs,
      lastSequence: input.sequence,
      lastAppliedSequence: input.sequence,
      holdFeedbackEmitted: false,
      samples: [],
    };
    this.queuedPointerEvents.push({ type: 'begin', input, sessionId, receivedAtMs: nowMs });
    return sessionId;
  }

  public moveDrag(input: DragPointerInput): void {
    if (!isValidPointerInput(input) || !this.isAcceptedDragInput(input)) return;
    this.queuedPointerEvents.push({ type: 'move', input, receivedAtMs: this.options.now() });
    const session = this.dragSession;
    if (session !== undefined) session.lastSequence = input.sequence;
  }

  public releaseDrag(input: DragPointerInput): void {
    if (!isValidPointerInput(input) || !this.isAcceptedDragInput(input)) return;
    this.queuedPointerEvents.push({ type: 'release', input, receivedAtMs: this.options.now() });
    const session = this.dragSession;
    if (session !== undefined) session.lastSequence = input.sequence;
  }

  public tick(): boolean {
    if (!this.running || this.lastTickAtMs === undefined || this.simulationAtMs === undefined) return false;
    const nowMs = this.options.now();
    const elapsedSec = Math.max(0, (nowMs - this.lastTickAtMs) / 1000);
    const constraints = this.constraints();
    this.lastTickAtMs = nowMs;
    this.accumulatorSec += Math.min(elapsedSec, constraints.maxFrameDeltaSec);

    const motionAtTickStart = this.motion;
    const wasPresentationDirty = this.presentationDirty;
    this.presentationDirty = false;
    let simulationAtMs = this.simulationAtMs;
    let voluntaryMovementCompleted = false;
    while (this.running && this.accumulatorSec >= constraints.fixedStepSec) {
      const environment = this.getEnvironmentSnapshot();
      const stepAtMs = simulationAtMs + constraints.fixedStepSec * 1000;
      this.applyQueuedInput(environment, stepAtMs);
      voluntaryMovementCompleted =
        this.step(this.getEnvironmentSnapshot(), stepAtMs, constraints.fixedStepSec) || voluntaryMovementCompleted;
      simulationAtMs = stepAtMs;
      this.simulationAtMs = simulationAtMs;
      this.accumulatorSec -= constraints.fixedStepSec;
    }
    if (this.dragSession !== undefined && this.motion.phase === 'dragged') {
      this.emitDragHold(this.dragSession, nowMs);
    }

    const positionChanged =
      this.motion.position.x !== motionAtTickStart.position.x ||
      this.motion.position.y !== motionAtTickStart.position.y;
    if (this.running && positionChanged) {
      const environment = this.getEnvironmentSnapshot();
      const rootPosition = this.options.positionService?.updateRootPosition(
        this.motion.position,
        environment.screenBounds,
        constraints.collisionInsets
      ) ?? this.motion.position;
      if (
        rootPosition.x !== this.motion.position.x ||
        rootPosition.y !== this.motion.position.y
      ) {
        this.motion = { ...this.motion, position: rootPosition };
      }
      this.options.positionPort.commitRootPosition({ rootPosition, bounds: environment.screenBounds });
    }
    const presentationChanged =
      this.running &&
      (positionChanged ||
        wasPresentationDirty ||
        this.motion.phase !== motionAtTickStart.phase ||
        this.motion.velocityPxPerSec.x !== motionAtTickStart.velocityPxPerSec.x ||
        this.motion.velocityPxPerSec.y !== motionAtTickStart.velocityPxPerSec.y);
    if (presentationChanged) this.presentationRevision += 1;
    const completed = this.completedTraversal;
    this.completedTraversal = undefined;
    if (this.running && completed !== undefined) {
      this.options.onVoluntaryMovementCompleted?.(completed);
    } else if (this.running && voluntaryMovementCompleted) {
      this.options.onVoluntaryMovementCompleted?.();
    }
    return presentationChanged;
  }

  public availableExternalSurfaces(): readonly ExternalWindowSurface[] {
    const snapshot = this.options.externalWindows?.getSnapshot();
    if (snapshot !== undefined && Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0
        && (this.externalSnapshot === undefined || snapshot.revision > this.externalSnapshot.revision)) {
      this.externalSnapshot = snapshot;
    }
    const accepted = this.externalSnapshot;
    return accepted?.capability === 'available' && isFreshExternalObservation(accepted.capturedAtMs, this.options.now())
      ? accepted.surfaces.filter(isExternalSurface) : [];
  }

  public getEnvironmentSnapshot(): EnvironmentSnapshot {
    const base = this.options.environment(this.motion.position);
    if (this.selectedExternalId === undefined) return base;
    const surface = this.availableExternalSurfaces().find(candidate => candidate.id === this.selectedExternalId);
    if (surface === undefined) return { ...base, currentSurface: undefined };
    const local = this.surface.externalAttachment?.localDistancePx ?? 0;
    const environment = this.options.environment({ x: surface.bounds.x + local, y: surface.bounds.y });
    // Crossing displays/DPI is a new attachment opportunity, not implicit follow.
    if (environment.screenBounds.id !== this.motion.activeBoundsId) return { ...base, currentSurface: undefined };
    return { ...environment, capturedAtMs: this.externalSnapshot!.capturedAtMs, currentSurface: surface };
  }

  public getMotionState(): MotionState {
    return this.motion;
  }

  public getSurfaceState(): SurfaceKinematicsState {
    return this.surface;
  }

  public getPresentationRevision(): number {
    return this.presentationRevision;
  }

  public canAcceptVoluntaryMovement(): boolean {
    return (
      this.running &&
      this.dragSession === undefined &&
      !this.hasQueuedBegin() &&
      this.motion.phase === 'grounded' &&
      (this.surface.phase === 'grounded' || this.surface.externalAttachment?.surface.kind === 'window_top') && this.traversal === undefined
    );
  }

  public requestVoluntaryMovement(command: VoluntaryRootCommand): boolean {
    if (
      !this.canAcceptVoluntaryMovement() ||
      this.voluntaryCommand !== undefined ||
      !isFiniteVector(command.targetRootPosition) ||
      (command.kind === 'horizontal_wander' &&
        (!Number.isFinite(command.speedPxPerSec) || command.speedPxPerSec <= 0))
    ) return false;
    const environment = this.getEnvironmentSnapshot();
    let targetRootPosition: Vector2Dto;
    try {
      targetRootPosition = clampRootPosition(
        command.targetRootPosition,
        environment.screenBounds,
        this.constraints().collisionInsets
      );
    } catch {
      return false;
    }
    const attachment = this.surface.externalAttachment;
    if (attachment !== undefined) {
      if (command.kind !== 'horizontal_wander' || attachment.surface.kind !== 'window_top'
          || targetRootPosition.x < attachment.surface.bounds.x
          || targetRootPosition.x > attachment.surface.bounds.x + attachment.surface.bounds.width) return false;
      this.externalWalkTarget = targetRootPosition.x - attachment.surface.bounds.x;
    }
    if (
      targetRootPosition.x === this.motion.position.x &&
      targetRootPosition.y === this.motion.position.y
    ) return false;
    this.voluntaryCommand = command.kind === 'manual_root'
      ? { kind: 'manual_root', targetRootPosition }
      : { kind: 'horizontal_wander', targetRootPosition, speedPxPerSec: command.speedPxPerSec };
    return true;
  }

  public requestTraversal(request: TraversalRequest): boolean {
    if (!this.running || this.dragSession !== undefined || this.hasQueuedBegin()
        || this.motion.phase !== 'grounded' || this.traversal !== undefined || this.voluntaryCommand !== undefined
        || request.runId.trim().length === 0 || request.stepId.trim().length === 0
        || (this.attachmentRunId !== undefined && this.attachmentRunId !== request.runId)) return false;
    if (!this.isTraversalEnvironmentValid(request, this.getEnvironmentSnapshot())) return false;
    const action = request.action;
    let range;
    try { range = calculateRootCollisionRange(action.bounds, this.constraints().collisionInsets); } catch { return false; }
    if (!isFiniteVector(this.motion.position) || this.motion.position.y < range.minY || this.motion.position.y > range.maxY) return false;
    if (action.kind === 'screen_climb') {
      const x = action.side === 'left' ? range.minX : range.maxX;
      if (Math.abs(this.motion.position.x - x) > 1
          || (action.direction === 'up' && this.motion.position.y <= range.minY)
          || (action.direction === 'down' && this.motion.position.y >= range.maxY)) return false;
    } else if (this.jumpPlan(action.target, action.bounds) === null) return false;
    this.traversal = { ...request, action: { ...action, bounds: { ...action.bounds },
      ...(action.kind === 'directed_jump' ? { target: { ...action.target } } : {}) } };
    this.traversalStarted = false;
    return true;
  }

  private jumpPlan(target: Vector2Dto, bounds: EnvironmentSnapshot['screenBounds']) {
    return this.options.motionEngine.planDirectedJump(this.motion.position, target, bounds);
  }

  private isTraversalEnvironmentValid(request: TraversalRequest, environment: EnvironmentSnapshot): boolean {
    const a = request.action.bounds;
    const b = environment.screenBounds;
    if (a.id !== b.id || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false;
    const support = environment.currentSurface;
    if ((!this.traversalStarted || request.action.kind === 'screen_climb' || support?.id === request.action.supportId) && (support?.id !== request.action.supportId || !support.isValidSupport
        || (support.kind !== 'screen_floor' && support.kind !== 'window_top'))) return false;
    if (request.action.kind === 'directed_jump') {
      try {
        const range = calculateRootCollisionRange(b, this.constraints().collisionInsets);
        const target = request.action.targetSurface;
        if (target !== undefined) {
          const live = this.availableExternalSurfaces().find(s => s.id === target.id);
          return live?.kind === 'window_top' && live.bounds.x === target.bounds.x && live.bounds.y === target.bounds.y
            && live.bounds.width === target.bounds.width && live.bounds.height === target.bounds.height
            && request.action.target.y === live.bounds.y && request.action.target.x >= live.bounds.x
            && request.action.target.x <= live.bounds.x + live.bounds.width;
        }
        return request.action.target.y === range.maxY;
      } catch { return false; }
    }
    return true;
  }

  public cancelVoluntaryMovement(forDrag = false): boolean {
    this.externalWalkTarget = undefined;
    if (forDrag) {
      this.selectedExternalId = undefined;
      if (this.surface.externalAttachment !== undefined) this.surface = groundedSurface(this.simulationAtMs ?? this.options.now());
    } else if (this.surface.externalAttachment !== undefined) {
      this.surface = { ...this.surface, locomotionVelocityPxPerSec: { x: 0, y: 0 } };
    }
    const hadTraversal = this.traversal !== undefined || this.attachmentRunId !== undefined;
    this.traversal = undefined;
    this.completedTraversal = undefined;
    this.traversalStarted = false;
    this.attachmentRunId = undefined;
    if (hadTraversal) {
      this.motion = { ...this.motion, directedJump: undefined };
      if (forDrag) {
        this.surface = groundedSurface(this.simulationAtMs ?? this.options.now());
      } else if (this.motion.phase === 'airborne' || this.surface.phase === 'climbing_wall') {
        const lost = this.options.motionEngine.beginAirborne(this.motion, {
          cause: 'support_lost', position: this.motion.position, velocityPxPerSec: this.motion.velocityPxPerSec,
          boundsId: this.motion.activeBoundsId, atMs: this.options.now(),
        });
        this.motion = lost.state;
        this.surface = { ...groundedSurface(this.simulationAtMs ?? this.options.now()), phase: 'airborne' };
        this.presentationDirty = true;
        this.routeEvents(lost.events, []);
      }
    }
    const hadVoluntaryMovement = this.voluntaryCommand !== undefined;
    const changed =
      this.voluntaryCommand !== undefined ||
      this.motion.velocityPxPerSec.x !== 0 ||
      this.motion.velocityPxPerSec.y !== 0;
    this.voluntaryCommand = undefined;
    if (this.motion.phase === 'grounded') {
      this.motion = { ...this.motion, velocityPxPerSec: { x: 0, y: 0 } };
      if (this.surface.phase === 'grounded') {
        this.surface = { ...this.surface, locomotionVelocityPxPerSec: { x: 0, y: 0 } };
      }
    }
    if (changed) this.presentationDirty = true;
    return hadVoluntaryMovement || hadTraversal;
  }

  private constraints(): Pick<MotionConstraints, 'fixedStepSec' | 'maxFrameDeltaSec' | 'stumbleMaxSeverity' | 'throwSampling' | 'collisionInsets'> {
    return this.options.constraints ?? DEFAULT_MOTION_CONSTRAINTS;
  }

  private dragHoldThresholdMs(): number {
    return this.options.dragHoldThresholdMs ?? DEFAULT_DRAG_HOLD_THRESHOLD_MS;
  }

  private scheduleNextTick(): void {
    if (!this.running || this.options.scheduler === undefined) return;
    this.cancelScheduledTick = this.options.scheduler.schedule(() => {
      this.cancelScheduledTick = undefined;
      if (!this.running) return;
      this.tick();
      this.scheduleNextTick();
    });
  }

  private hasQueuedBegin(): boolean {
    return this.queuedPointerEvents.some((event) => event.type === 'begin');
  }

  private isAcceptedDragInput(input: DragPointerInput): boolean {
    return (
      this.dragSession !== undefined &&
      this.dragSession.id === input.dragSessionId &&
      this.dragSession.pointerId === input.pointerId &&
      input.sequence > this.dragSession.lastSequence
    );
  }

  private applyQueuedInput(environment: EnvironmentSnapshot, stepAtMs: number): void {
    const queued = this.queuedPointerEvents.splice(0).sort((left, right) => left.input.sequence - right.input.sequence);
    for (const event of queued) {
      if (event.type === 'begin') {
        if (this.dragSession === undefined || this.dragSession.id !== event.sessionId) continue;
        const started = this.options.motionEngine.beginDrag(
          this.motion,
          this.motion.position,
          environment.screenBounds.id,
          event.receivedAtMs
        );
        this.motion = started.state;
        this.surface = groundedSurface(stepAtMs);
        this.dragSession.samples.push({ position: this.motion.position, capturedAtMs: event.receivedAtMs });
        this.routeEvents(started.events, []);
        continue;
      }
      const session = this.dragSession;
      if (
        session === undefined ||
        session.id !== event.input.dragSessionId ||
        session.pointerId !== event.input.pointerId ||
        event.input.sequence <= session.lastAppliedSequence
      ) continue;
      const rootPosition = {
        x: event.input.screenPosition.x + session.grabOffset.x,
        y: event.input.screenPosition.y + session.grabOffset.y,
      };
      this.motion = this.options.motionEngine.updateDraggedPosition(this.motion, rootPosition);
      session.samples.push({ position: rootPosition, capturedAtMs: event.receivedAtMs });
      session.lastAppliedSequence = event.input.sequence;
      if (event.type === 'release') {
        this.emitDragHold(session, event.receivedAtMs);
        const throwVector = this.options.motionEngine.estimateThrow(session.samples, event.receivedAtMs);
        const candidate = Math.hypot(throwVector.vxPxPerSec, throwVector.vyPxPerSec) <= 300
          ? selectWindowTopForRelease(this.availableExternalSurfaces(), this.motion.position,
              point => this.options.environment(point), this.constraints().collisionInsets) : null;
        if (candidate !== null) {
          const selectedEnvironment = { ...this.options.environment(this.motion.position),
            capturedAtMs: this.externalSnapshot!.capturedAtMs, currentSurface: candidate };
          const attached = this.options.surfaceKinematics.startExternalSupport({ motion: this.motion,
            environment: selectedEnvironment, nowMs: stepAtMs, observationNowMs: this.options.now(),
            collisionInsets: this.constraints().collisionInsets });
          if (attached !== null) {
            this.selectedExternalId = candidate.id;
            this.surface = attached.state; this.motion = attached.motion.state;
            this.dragSession = undefined;
            this.routeEvents([{ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 }], attached.events);
            this.emitFeedback({ type: 'drag_ended', eventId: `${session.id}:ended`, dragRunId: session.id,
              heldMs: Math.max(0, event.receivedAtMs - session.startedAtMs), atMs: event.receivedAtMs });
            this.presentationDirty = true;
            continue;
          }
        }
        const released = this.options.motionEngine.release(this.motion, throwVector);
        this.motion = released.state;
        this.surface = { ...groundedSurface(stepAtMs), phase: 'airborne' };
        this.routeEvents(released.events, []);
        this.emitFeedback({
          type: 'drag_ended', eventId: `${session.id}:ended`, dragRunId: session.id,
          heldMs: Math.max(0, event.receivedAtMs - session.startedAtMs), atMs: event.receivedAtMs,
        });
        this.dragSession = undefined;
      }
    }
  }

  private emitDragHold(session: DragSession, atMs: number): void {
    const heldMs = atMs - session.startedAtMs;
    if (
      session.holdFeedbackEmitted ||
      !Number.isFinite(heldMs) ||
      heldMs < this.dragHoldThresholdMs()
    ) {
      return;
    }
    session.holdFeedbackEmitted = true;
    this.emitFeedback({
      type: 'drag_hold',
      eventId: `${session.id}:hold`,
      dragRunId: session.id,
      heldMs,
      atMs,
    });
  }

  private step(environment: EnvironmentSnapshot, nowMs: number, stepSec: number): boolean {
    const request = this.traversal;
    if (request !== undefined) {
      if (!this.isTraversalEnvironmentValid(request, environment)) {
        this.cancelVoluntaryMovement();
        this.options.onTraversalRejected?.(request);
      } else if (!this.traversalStarted) {
        this.traversalStarted = true;
        if (request.action.kind === 'screen_climb') {
          const started = this.options.surfaceKinematics.startWallClimb({ motion: this.motion, environment,
            side: request.action.side, verticalSpeedPxPerSec: request.action.direction === 'up' ? -SCREEN_CLIMB_SPEED : SCREEN_CLIMB_SPEED,
            nowMs, climbLimits: calculateRootCollisionRange(environment.screenBounds, this.constraints().collisionInsets) });
          if (started === null) { this.cancelVoluntaryMovement(); this.options.onTraversalRejected?.(request); return false; }
          this.surface = started.state;
          this.motion = started.motion.state;
          this.attachmentRunId = request.runId;
          this.routeEvents(started.motion.events, started.events);
        } else {
          const plan = this.jumpPlan(request.action.target, environment.screenBounds);
          if (plan === null) { this.cancelVoluntaryMovement(); this.options.onTraversalRejected?.(request); return false; }
          const launched = this.options.motionEngine.beginAirborne(this.motion, { cause: 'voluntary_jump',
            position: this.motion.position, velocityPxPerSec: plan.initialVelocity,
            boundsId: environment.screenBounds.id, atMs: nowMs, directedJump: plan });
          this.selectedExternalId = undefined;
          this.motion = launched.state;
          this.surface = { ...groundedSurface(nowMs), phase: 'airborne' };
          this.attachmentRunId = undefined;
          this.routeEvents(launched.events, []);
        }
      }
    }
    const attachment = this.surface.externalAttachment;
    if (attachment !== undefined && this.externalWalkTarget !== undefined && this.voluntaryCommand?.kind === 'horizontal_wander') {
      const delta = this.externalWalkTarget - attachment.localDistancePx;
      this.surface = { ...this.surface, locomotionVelocityPxPerSec: {
        x: Math.sign(delta) * Math.min(this.voluntaryCommand.speedPxPerSec, Math.abs(delta) / stepSec), y: 0 } };
    }
    const surfaceResult = this.options.surfaceKinematics.step(
      { state: this.surface, motion: this.motion, environment, nowMs,
        observationNowMs: this.options.now(), collisionInsets: this.constraints().collisionInsets },
      this.options.motionEngine
    );
    this.surface = surfaceResult.state;
    this.motion = surfaceResult.motion.state;
    if (surfaceResult.events.some(event => event.type === 'support_lost')) {
      this.selectedExternalId = undefined; this.externalWalkTarget = undefined;
    }
    let motionEvents = surfaceResult.motion.events;
    if (
      this.motion.phase === 'airborne' &&
      this.surface.phase !== 'climbing_wall' &&
      this.surface.phase !== 'hanging_ceiling'
    ) {
      const motionResult = this.options.motionEngine.step({ state: this.motion, stepSec, bounds: environment.screenBounds });
      this.motion = motionResult.state;
      motionEvents = [...motionEvents, ...motionResult.events];
    }
    if (this.traversal?.action.kind === 'directed_jump' && this.traversal.action.targetSurface !== undefined
        && motionEvents.some(event => event.type === 'landed')) {
      const targetId = this.traversal.action.targetSurface.id;
      const target = this.availableExternalSurfaces().find(s => s.id === targetId);
      const attached = target === undefined ? null : this.options.surfaceKinematics.startExternalSupport({
        motion: this.motion, environment: { ...environment, capturedAtMs: this.externalSnapshot!.capturedAtMs, currentSurface: target },
        nowMs, observationNowMs: this.options.now(), collisionInsets: this.constraints().collisionInsets });
      if (attached !== null) {
        this.selectedExternalId = target!.id; this.surface = attached.state; this.motion = attached.motion.state;
      }
    }
    if (motionEvents.some((event) => event.type === 'jump_missed')) this.cancelVoluntaryMovement();
    if (this.motion.phase === 'grounded' && this.surface.phase === 'airborne') this.surface = groundedSurface(nowMs);
    const completed = this.traversal;
    if (completed !== undefined && (surfaceResult.events.some((event) => event.type === 'wall_limit_reached')
        || motionEvents.some((event) => event.type === 'landed'))) {
      this.completedTraversal = completed;
      this.traversal = undefined;
      this.traversalStarted = false;
      if (this.surface.phase === 'grounded') this.attachmentRunId = undefined;
    }
    const voluntaryMovementCompleted = this.stepVoluntaryMovement(environment, stepSec);
    this.routeEvents(motionEvents, surfaceResult.events);
    return voluntaryMovementCompleted;
  }

  private stepVoluntaryMovement(environment: EnvironmentSnapshot, stepSec: number): boolean {
    if (this.surface.externalAttachment !== undefined) {
      if (this.externalWalkTarget !== undefined
          && Math.abs(this.surface.externalAttachment.localDistancePx - this.externalWalkTarget) < .001) {
        this.voluntaryCommand = undefined; this.externalWalkTarget = undefined;
        this.surface = { ...this.surface, locomotionVelocityPxPerSec: { x: 0, y: 0 } };
        this.motion = { ...this.motion, velocityPxPerSec: { x: 0, y: 0 } };
        return true;
      }
      return false;
    }
    if (this.motion.phase !== 'grounded' || this.surface.phase !== 'grounded') {
      if (this.voluntaryCommand !== undefined) this.cancelVoluntaryMovement();
      return false;
    }
    let range;
    try {
      range = calculateRootCollisionRange(environment.screenBounds, this.constraints().collisionInsets);
    } catch {
      this.cancelVoluntaryMovement();
      return false;
    }

    const floorY = environment.currentSurface?.kind === 'screen_floor' ? range.maxY : undefined;
    const clampedCurrent = clampRootPosition(this.motion.position, environment.screenBounds, this.constraints().collisionInsets);
    const command = this.voluntaryCommand;
    const current = command?.kind === 'horizontal_wander'
      ? { x: clampedCurrent.x, y: floorY ?? clampedCurrent.y }
      : clampedCurrent;
    if (command === undefined) {
      if (current.x !== this.motion.position.x || current.y !== this.motion.position.y) {
        this.motion = { ...this.motion, position: current, activeBoundsId: environment.screenBounds.id };
      }
      return false;
    }

    const target = clampRootPosition(command.targetRootPosition, environment.screenBounds, this.constraints().collisionInsets);
    const groundedTarget = command.kind === 'manual_root'
      ? target
      : { x: target.x, y: floorY ?? current.y };
    const deltaX = groundedTarget.x - current.x;
    const deltaY = groundedTarget.y - current.y;
    const distance = Math.hypot(deltaX, deltaY);
    const maxStep = command.kind === 'manual_root'
      ? Number.POSITIVE_INFINITY
      : command.speedPxPerSec * stepSec;
    const completed = distance <= maxStep;
    const scale = completed ? 1 : maxStep / distance;
    const position = completed
      ? groundedTarget
      : { x: current.x + deltaX * scale, y: current.y + deltaY * scale };
    const velocityPxPerSec = completed
      ? { x: 0, y: 0 }
      : command.kind === 'horizontal_wander'
        ? { x: (deltaX / distance) * command.speedPxPerSec, y: (deltaY / distance) * command.speedPxPerSec }
        : { x: 0, y: 0 };
    this.motion = {
      ...this.motion,
      position,
      velocityPxPerSec,
      activeBoundsId: environment.screenBounds.id,
    };
    this.surface = { ...this.surface, locomotionVelocityPxPerSec: velocityPxPerSec };
    if (completed) {
      this.voluntaryCommand = undefined;
      return true;
    }
    return false;
  }

  private routeEvents(motionEvents: readonly MotionEvent[], surfaceEvents: readonly SurfaceKinematicsEvent[]): void {
    // Wake/cancel before a possible same-substep floor landing resumes autonomy.
    for (const event of surfaceEvents) {
      if (event.type === 'support_lost') this.options.eventDispatcher?.dispatchSurfaceEvent(event);
    }
    for (const event of motionEvents) {
      this.options.eventDispatcher?.dispatchMotionEvent(event);
      if (event.type === 'drag_started') {
        this.emitFeedback({ type: 'drag_started', eventId: `${this.dragSession?.id ?? 'unknown'}:started`, atMs: event.atMs });
      } else if (event.type === 'landed' && event.outcome !== 'soft_landing') {
        this.emitFeedback({ type: 'landing', eventId: `landing:${this.presentationRevision + 1}:${event.outcome}`, outcome: event.outcome, impactSeverity: event.impactSeverity, atMs: this.lastTickAtMs ?? 0 });
      }
    }
    for (const event of surfaceEvents) {
      if (event.type !== 'support_lost') this.options.eventDispatcher?.dispatchSurfaceEvent(event);
    }
  }

  private emitFeedback(event: ShimejiFeedbackEvent): void {
    const mapper = this.options.stimulusMapper;
    if (mapper === undefined || this.emittedStimulusIds.has(event.eventId)) return;
    const stimulus = mapper.map(event, {
      createdAtIso: this.options.createStimulusTimestamp?.() ?? '',
      landingThresholds: { stumbleMaxSeverity: this.constraints().stumbleMaxSeverity },
    });
    if (stimulus === null || this.emittedStimulusIds.has(stimulus.id)) return;
    this.emittedStimulusIds.add(event.eventId);
    this.emittedStimulusIds.add(stimulus.id);
    this.options.applyStimulus?.(stimulus);
  }
}
