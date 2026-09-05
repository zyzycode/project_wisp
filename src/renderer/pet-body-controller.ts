import type {
  BodyEventDTO,
  BodyInteractionTypeDTO,
  BrainStateDTO,
} from '../shared/ipc-contracts';
import type {
  BodyVisualReflexState,
  BodyVisualState,
} from './render-engine/skin-engine';
import {
  BrainStateRevisionGate,
  postBodyEvent,
  subscribeToBrainState,
  type PetMainBridge,
} from './pet-main-bridge';

export interface PetBodySnapshot {
  readonly brain: BrainStateDTO;
  readonly visual: BodyVisualState;
}

export type PetBodySnapshotListener = (snapshot: PetBodySnapshot) => void;

interface ActiveBodyGesture {
  readonly gestureId: string;
  readonly pointerId: number;
}

type BodyEventPayload<Event extends BodyEventDTO = BodyEventDTO> =
  Event extends BodyEventDTO
    ? Omit<Event, 'streamId' | 'sequence' | 'basedOnRevision' | 'observedAtMs'>
    : never;

const NEUTRAL_REFLEX: BodyVisualReflexState = {
  pupilOffset: { x: 0, y: 0 },
  transform: { flipX: false, scaleX: 1, scaleY: 1, rotationDeg: 0 },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Renderer Body boundary: ordered Brain projection plus local visual reflexes and input. */
export class PetBodyController {
  private readonly revisionGate: BrainStateRevisionGate;
  private readonly listeners = new Set<PetBodySnapshotListener>();
  private unsubscribeBrain: (() => void) | null = null;
  private snapshot: PetBodySnapshot | null = null;
  private bodySequence = 0;
  private visualRevision = 0;
  private gestureSequence = 0;
  private activeGesture: ActiveBodyGesture | null = null;
  private resetBeforeNextSubscription = false;

  public constructor(
    private readonly bridge: PetMainBridge,
    private readonly now: () => number = () => performance.now(),
    reportDiagnostic: (message: string) => void = console.warn
  ) {
    this.revisionGate = new BrainStateRevisionGate(reportDiagnostic);
  }

  public subscribe(listener: PetBodySnapshotListener): () => void {
    if (this.resetBeforeNextSubscription) this.resetSubscriptionLifecycle();
    this.listeners.add(listener);
    if (this.snapshot !== null) listener(this.snapshot);
    if (this.unsubscribeBrain === null) {
      this.unsubscribeBrain = subscribeToBrainState(this.bridge, (payload) => {
        this.acceptBrainState(payload);
      });
    }
    return (): void => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  public disconnect(): void {
    this.unsubscribeBrain?.();
    this.unsubscribeBrain = null;
    this.resetBeforeNextSubscription = true;
  }

  public acceptBrainState(payload: unknown): PetBodySnapshot | null {
    const brain = this.revisionGate.accept(payload);
    if (brain === null) return null;
    const previousTransform = this.snapshot?.visual.reflex.transform ?? NEUTRAL_REFLEX.transform;
    const previousPupil = this.snapshot?.visual.reflex.pupilOffset ?? NEUTRAL_REFLEX.pupilOffset;
    const velocityX = brain.motion.velocityPxPerSec.x;
    const flipX = velocityX === 0 ? previousTransform.flipX : velocityX > 0;
    const rotationDeg = this.activeGesture === null
      ? clamp(velocityX * 0.02, -25, 25)
      : previousTransform.rotationDeg;
    return this.replaceSnapshot(brain, {
      pupilOffset: { ...previousPupil },
      transform: {
        ...previousTransform,
        flipX,
        rotationDeg,
      },
    });
  }

  public getSnapshot(): PetBodySnapshot | null {
    return this.snapshot;
  }

  public setPupilOffset(offset: { readonly x: number; readonly y: number }): void {
    const current = this.snapshot;
    if (current === null) return;
    const pupilOffset = {
      x: clamp(finiteOr(offset.x, 0), -1, 1),
      y: clamp(finiteOr(offset.y, 0), -1, 1),
    };
    if (
      pupilOffset.x === current.visual.reflex.pupilOffset.x &&
      pupilOffset.y === current.visual.reflex.pupilOffset.y
    ) return;
    this.replaceSnapshot(current.brain, {
      pupilOffset,
      transform: current.visual.reflex.transform,
    });
  }

  public setDragReflex(input: {
    readonly scaleX: number;
    readonly scaleY: number;
    readonly rotationDeg: number;
  }): void {
    const current = this.snapshot;
    if (current === null) return;
    const transform = {
      ...current.visual.reflex.transform,
      scaleX: clamp(finiteOr(input.scaleX, 1), 0.75, 1.25),
      scaleY: clamp(finiteOr(input.scaleY, 1), 0.75, 1.25),
      rotationDeg: clamp(finiteOr(input.rotationDeg, 0), -25, 25),
    };
    if (
      transform.scaleX === current.visual.reflex.transform.scaleX &&
      transform.scaleY === current.visual.reflex.transform.scaleY &&
      transform.rotationDeg === current.visual.reflex.transform.rotationDeg
    ) return;
    this.replaceSnapshot(current.brain, {
      pupilOffset: current.visual.reflex.pupilOffset,
      transform,
    });
  }

  public postInteraction(interaction: BodyInteractionTypeDTO, intensity?: number): boolean {
    return this.emit({
      type: 'interaction',
      interaction,
      ...(intensity === undefined ? {} : { intensity }),
    });
  }

  public postMenuVisibility(expanded: boolean): boolean {
    return this.emit({ type: 'menu_visibility_changed', expanded });
  }

  public beginDrag(
    pointerId: number,
    screenPosition: { readonly x: number; readonly y: number }
  ): string | null {
    if (this.activeGesture !== null || this.snapshot === null) return null;
    const gestureId = `gesture-${++this.gestureSequence}`;
    if (!this.emit({ type: 'drag_started', gestureId, pointerId, screenPosition })) return null;
    this.activeGesture = { gestureId, pointerId };
    return gestureId;
  }

  public moveDrag(
    gestureId: string,
    pointerId: number,
    screenPosition: { readonly x: number; readonly y: number }
  ): boolean {
    if (!this.matchesActiveGesture(gestureId, pointerId)) return false;
    return this.emit({ type: 'drag_moved', gestureId, pointerId, screenPosition });
  }

  public endDrag(
    gestureId: string,
    pointerId: number,
    screenPosition: { readonly x: number; readonly y: number },
    cancelled: boolean
  ): boolean {
    if (!this.matchesActiveGesture(gestureId, pointerId)) return false;
    this.activeGesture = null;
    return this.emit({
      type: 'drag_ended',
      gestureId,
      pointerId,
      screenPosition,
      cancelled,
    });
  }

  private matchesActiveGesture(gestureId: string, pointerId: number): boolean {
    return this.activeGesture?.gestureId === gestureId && this.activeGesture.pointerId === pointerId;
  }

  private emit(
    event: BodyEventPayload
  ): boolean {
    const current = this.snapshot;
    if (current === null) return false;
    const payload = {
      ...event,
      streamId: current.brain.streamId,
      sequence: ++this.bodySequence,
      basedOnRevision: current.brain.revision,
      observedAtMs: this.now(),
    } as BodyEventDTO;
    void postBodyEvent(this.bridge, payload).catch((error: unknown) => {
      console.error('Body event delivery failed:', error);
    });
    return true;
  }

  private replaceSnapshot(
    brain: BrainStateDTO,
    reflex: BodyVisualReflexState
  ): PetBodySnapshot {
    const snapshot: PetBodySnapshot = {
      brain,
      visual: {
        streamId: brain.streamId,
        revision: ++this.visualRevision,
        visualIntent: brain.visualIntent,
        visualAgeMs: brain.sampledAtMs - brain.visualIntent.episodeStartedAtMs,
        reflex,
      },
    };
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  private resetSubscriptionLifecycle(): void {
    this.revisionGate.reset();
    this.snapshot = null;
    this.bodySequence = 0;
    this.visualRevision = 0;
    this.gestureSequence = 0;
    this.activeGesture = null;
    this.resetBeforeNextSubscription = false;
  }
}
