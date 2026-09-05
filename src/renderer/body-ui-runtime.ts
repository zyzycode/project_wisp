export interface AnimationFrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(frameId: number): void;
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
