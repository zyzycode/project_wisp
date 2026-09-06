export interface AnimationFrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(frameId: number): void;
}

export const CURSOR_OBSERVATION_MIN_INTERVAL_MS = 100;

export interface CursorScreenPosition {
  readonly x: number;
  readonly y: number;
}

export interface CursorObservationScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CursorObservationCompatibility {
  readonly autonomyEnabled: boolean;
  readonly menuOpen: boolean;
  readonly dragging: boolean;
  readonly motionPhase: 'dragged' | 'airborne' | 'grounded' | undefined;
  readonly activityId: string | null | undefined;
  readonly visualKind: string | undefined;
}

export function isCursorObservationCompatible(input: CursorObservationCompatibility): boolean {
  return (
    input.autonomyEnabled &&
    !input.menuOpen &&
    !input.dragging &&
    input.motionPhase === 'grounded' &&
    (input.activityId === 'observe_cursor' ||
      (input.activityId === null && input.visualKind === 'idle_blink'))
  );
}

/** One leading sample plus one latest-sample refresh per bounded interval. */
export class CursorObservationRefresh {
  private latest: CursorScreenPosition | undefined;
  private timer: unknown;
  private destroyed = false;
  private nextEligibleAtMs = Number.NEGATIVE_INFINITY;

  public constructor(
    private readonly emitObservation: (position: CursorScreenPosition) => void,
    private readonly scheduler: CursorObservationScheduler,
    private readonly intervalMs = CURSOR_OBSERVATION_MIN_INTERVAL_MS
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError('Cursor observation interval must be positive');
    }
  }

  public observe(position: CursorScreenPosition): void {
    if (this.destroyed || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    this.latest = { ...position };
    if (this.timer !== undefined) return;
    const nowMs = this.scheduler.now();
    if (nowMs >= this.nextEligibleAtMs) {
      this.emitCurrent(nowMs);
      return;
    }
    this.schedule(this.nextEligibleAtMs - nowMs);
  }

  public clear(): void {
    this.latest = undefined;
    this.clearTimer();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.latest = undefined;
    this.clearTimer();
  }

  private emitCurrent(nowMs: number): void {
    const current = this.latest;
    if (this.destroyed || current === undefined) return;
    this.nextEligibleAtMs = nowMs + this.intervalMs;
    this.emitObservation(current);
    if (!this.destroyed && this.latest !== undefined && this.timer === undefined) {
      this.schedule(this.intervalMs);
    }
  }

  private schedule(delayMs: number): void {
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      if (this.destroyed || this.latest === undefined) return;
      const nowMs = this.scheduler.now();
      if (nowMs < this.nextEligibleAtMs) {
        this.schedule(this.nextEligibleAtMs - nowMs);
        return;
      }
      this.emitCurrent(nowMs);
    }, Math.max(0, delayMs));
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

/** A reusable latest-wins queue used by the drag hook for one event per RAF. */
export class LatestAnimationFrameQueue<Value> {
  private frameId: number | null = null;
  private latest: Value | null = null;

  public constructor(
    private readonly scheduler: AnimationFrameScheduler,
    private readonly emit: (value: Value) => void
  ) {}

  public push(value: Value): void {
    this.latest = value;
    if (this.frameId !== null) return;
    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      const latest = this.latest;
      this.latest = null;
      if (latest !== null) this.emit(latest);
    });
  }

  public clear(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.latest = null;
  }

  public dispose(): void {
    this.clear();
  }
}

export interface PetPointerEvent {
  readonly pointerId: number;
  readonly screenX: number;
  readonly screenY: number;
}

export interface PetDragGlobalHandlers {
  readonly move: (event: PetPointerEvent) => void;
  readonly end: (event: PetPointerEvent) => void;
  readonly cancel: (event: PetPointerEvent) => void;
}

export interface ListenerTarget {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

export interface VisibilityListenerTarget extends ListenerTarget {
  readonly hidden: boolean;
}

export function registerCursorObservationListeners(
  pointerTarget: ListenerTarget,
  visibilityTarget: VisibilityListenerTarget,
  handlers: {
    readonly move: (event: { readonly screenX: number; readonly screenY: number }) => void;
    readonly unavailable: () => void;
  }
): () => void {
  const move = handlers.move as (event: never) => void;
  const unavailable = handlers.unavailable as (event: never) => void;
  const visibilityChanged = (() => {
    if (visibilityTarget.hidden) handlers.unavailable();
  }) as (event: never) => void;
  pointerTarget.addEventListener('mousemove', move);
  pointerTarget.addEventListener('pointerleave', unavailable);
  pointerTarget.addEventListener('pointercancel', unavailable);
  visibilityTarget.addEventListener('visibilitychange', visibilityChanged);
  return (): void => {
    pointerTarget.removeEventListener('mousemove', move);
    pointerTarget.removeEventListener('pointerleave', unavailable);
    pointerTarget.removeEventListener('pointercancel', unavailable);
    visibilityTarget.removeEventListener('visibilitychange', visibilityChanged);
  };
}

export function registerPetDragGlobalListeners(
  target: ListenerTarget,
  handlers: PetDragGlobalHandlers
): () => void {
  const move = handlers.move as (event: never) => void;
  const end = handlers.end as (event: never) => void;
  const cancel = handlers.cancel as (event: never) => void;
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', cancel);
  return (): void => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', cancel);
  };
}

export interface OverlayElement {
  closest(selector: string): unknown | null;
}

export interface OverlayDocument {
  elementFromPoint(clientX: number, clientY: number): OverlayElement | null;
}

export function isInteractiveOverlayPoint(
  ownerDocument: OverlayDocument,
  clientX: number,
  clientY: number
): boolean {
  const element = ownerDocument.elementFromPoint(clientX, clientY);
  return element !== null && element.closest('[data-wisp-interactive="true"]') !== null;
}

export function shouldIgnoreOverlayPointer(
  forceInteractive: boolean,
  ownerDocument: OverlayDocument,
  clientX: number,
  clientY: number
): boolean {
  return !forceInteractive && !isInteractiveOverlayPoint(ownerDocument, clientX, clientY);
}

export function registerOverlayMouseListener(
  target: ListenerTarget,
  listener: (event: { readonly clientX: number; readonly clientY: number }) => void
): () => void {
  const typedListener = listener as (event: never) => void;
  target.addEventListener('mousemove', typedListener);
  return (): void => target.removeEventListener('mousemove', typedListener);
}

/** Prevents an async provider result from mutating presentation after unmount. */
export class DialogueEffectLifecycle {
  private active = false;

  public mount(): void {
    this.active = true;
  }

  public dispose(): void {
    this.active = false;
  }

  public isActive(): boolean {
    return this.active;
  }
}
