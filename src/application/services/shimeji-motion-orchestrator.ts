import type { PetPositionPort } from '../ports/pet-position-port';
import {
  DEFAULT_MOTION_CONSTRAINTS,
  type IMotionEngine,
  type MotionConstraints,
  type MotionEvent,
  type MotionState,
  type PointerMotionSample,
  type Vector2Dto,
} from '../../domain/behavior/motion-engine';
import {
  SurfaceKinematics,
  type EnvironmentSnapshot,
  type SurfaceKinematicsEvent,
  type SurfaceKinematicsState,
} from '../../domain/behavior/surface-kinematics';
import type { CharacterStimulus } from '../../domain/character/stimuli-reducer';

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

export type ShimejiFeedbackEvent =
  | { readonly type: 'drag_started'; readonly eventId: string; readonly atMs: number }
  | { readonly type: 'drag_ended'; readonly eventId: string; readonly dragRunId: string; readonly heldMs: number; readonly atMs: number }
  | { readonly type: 'landing'; readonly eventId: string; readonly outcome: 'stumble' | 'crash_landing'; readonly impactSeverity: number; readonly atMs: number };

export type StimulusDto = CharacterStimulus & { readonly id: string };

export interface ShimejiStimulusMappingContext {
  readonly createdAtIso: string;
  readonly landingThresholds: Pick<MotionConstraints, 'stumbleMaxSeverity'>;
}

export interface IShimejiStimulusMapper {
  map(event: ShimejiFeedbackEvent, context: ShimejiStimulusMappingContext): StimulusDto | null;
}

export interface ShimejiMotionScheduler {
  schedule(callback: () => void): () => void;
}

export interface ShimejiMotionOrchestratorOptions {
  readonly initialMotion: MotionState;
  readonly initialSurface: SurfaceKinematicsState;
  readonly motionEngine: IMotionEngine;
  readonly surfaceKinematics: SurfaceKinematics;
  readonly environment: () => EnvironmentSnapshot;
  readonly positionPort: PetPositionPort;
  readonly now: () => number;
  readonly scheduler?: ShimejiMotionScheduler;
  readonly constraints?: Pick<MotionConstraints, 'fixedStepSec' | 'maxFrameDeltaSec' | 'stumbleMaxSeverity' | 'throwSampling'>;
  readonly eventDispatcher?: ShimejiMotionEventDispatcher;
  readonly stimulusMapper?: IShimejiStimulusMapper;
  readonly applyStimulus?: (stimulus: StimulusDto) => void;
  readonly createDragSessionId?: () => string;
}

interface DragSession {
  readonly id: string;
  readonly pointerId: number;
  readonly grabOffset: Vector2Dto;
  readonly startedAtMs: number;
  lastSequence: number;
  lastAppliedSequence: number;
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

  public constructor(private readonly options: ShimejiMotionOrchestratorOptions) {
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
    this.cancelScheduledTick?.();
    this.cancelScheduledTick = undefined;
  }

  public beginDrag(input: PointerInput): string | null {
    if (!isValidPointerInput(input) || this.dragSession !== undefined || this.hasQueuedBegin()) return null;
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
    let simulationAtMs = this.simulationAtMs;
    while (this.running && this.accumulatorSec >= constraints.fixedStepSec) {
      const environment = this.options.environment();
      const stepAtMs = simulationAtMs + constraints.fixedStepSec * 1000;
      this.applyQueuedInput(environment, stepAtMs);
      this.step(environment, stepAtMs, constraints.fixedStepSec);
      simulationAtMs = stepAtMs;
      this.simulationAtMs = simulationAtMs;
      this.accumulatorSec -= constraints.fixedStepSec;
    }

    const positionChanged =
      this.motion.position.x !== motionAtTickStart.position.x ||
      this.motion.position.y !== motionAtTickStart.position.y;
    if (this.running && positionChanged) {
      const environment = this.options.environment();
      this.options.positionPort.commitRootPosition({ rootPosition: this.motion.position, bounds: environment.screenBounds });
    }
    const presentationChanged =
      this.running &&
      (positionChanged ||
        this.motion.phase !== motionAtTickStart.phase ||
        this.motion.velocityPxPerSec.x !== motionAtTickStart.velocityPxPerSec.x ||
        this.motion.velocityPxPerSec.y !== motionAtTickStart.velocityPxPerSec.y);
    if (presentationChanged) this.presentationRevision += 1;
    return presentationChanged;
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

  private constraints(): Pick<MotionConstraints, 'fixedStepSec' | 'maxFrameDeltaSec' | 'stumbleMaxSeverity' | 'throwSampling'> {
    return this.options.constraints ?? DEFAULT_MOTION_CONSTRAINTS;
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
        const released = this.options.motionEngine.release(
          this.motion,
          this.options.motionEngine.estimateThrow(session.samples, event.receivedAtMs)
        );
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

  private step(environment: EnvironmentSnapshot, nowMs: number, stepSec: number): void {
    const surfaceResult = this.options.surfaceKinematics.step(
      { state: this.surface, motion: this.motion, environment, nowMs },
      this.options.motionEngine
    );
    this.surface = surfaceResult.state;
    this.motion = surfaceResult.motion.state;
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
    this.routeEvents(motionEvents, surfaceResult.events);
  }

  private routeEvents(motionEvents: readonly MotionEvent[], surfaceEvents: readonly SurfaceKinematicsEvent[]): void {
    for (const event of motionEvents) {
      this.options.eventDispatcher?.dispatchMotionEvent(event);
      if (event.type === 'drag_started') {
        this.emitFeedback({ type: 'drag_started', eventId: `${this.dragSession?.id ?? 'unknown'}:started`, atMs: event.atMs });
      } else if (event.type === 'landed' && event.outcome !== 'soft_landing') {
        this.emitFeedback({ type: 'landing', eventId: `landing:${this.presentationRevision + 1}:${event.outcome}`, outcome: event.outcome, impactSeverity: event.impactSeverity, atMs: this.lastTickAtMs ?? 0 });
      }
    }
    for (const event of surfaceEvents) this.options.eventDispatcher?.dispatchSurfaceEvent(event);
  }

  private emitFeedback(event: ShimejiFeedbackEvent): void {
    const mapper = this.options.stimulusMapper;
    if (mapper === undefined || this.emittedStimulusIds.has(event.eventId)) return;
    const stimulus = mapper.map(event, {
      createdAtIso: new Date(event.atMs).toISOString(),
      landingThresholds: { stumbleMaxSeverity: this.constraints().stumbleMaxSeverity },
    });
    if (stimulus === null || this.emittedStimulusIds.has(stimulus.id)) return;
    this.emittedStimulusIds.add(event.eventId);
    this.emittedStimulusIds.add(stimulus.id);
    this.options.applyStimulus?.(stimulus);
  }
}
