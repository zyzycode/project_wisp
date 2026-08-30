import type {
  BeginPetDragDTO,
  BeginPetDragResultDTO,
  MovePetDragDTO,
  PetPresentationStateDTO,
  ReleasePetDragDTO,
  WispApiBridge,
} from '../shared/ipc-contracts';

export type PetMainBridge = Pick<
  WispApiBridge,
  'beginPetDrag' | 'movePetDrag' | 'releasePetDrag' | 'onPetPresentationState'
>;

export function subscribeToPetPresentation(
  bridge: PetMainBridge,
  listener: (state: PetPresentationStateDTO) => void
): () => void {
  return bridge.onPetPresentationState(listener);
}

export function beginPetDrag(
  bridge: PetMainBridge,
  payload: BeginPetDragDTO
): Promise<BeginPetDragResultDTO> {
  return bridge.beginPetDrag(payload);
}

export function movePetDrag(bridge: PetMainBridge, payload: MovePetDragDTO): Promise<void> {
  return bridge.movePetDrag(payload);
}

export function releasePetDrag(bridge: PetMainBridge, payload: ReleasePetDragDTO): Promise<void> {
  return bridge.releasePetDrag(payload);
}

type PendingDragEvent =
  | { readonly type: 'move'; readonly sequence: number; readonly screenPosition: { readonly x: number; readonly y: number } }
  | { readonly type: 'release'; readonly sequence: number; readonly screenPosition: { readonly x: number; readonly y: number } };

interface ActiveDragSession {
  readonly id: string;
  readonly pointerId: number;
  sequence: number;
}

interface PendingDragSession {
  readonly token: number;
  readonly pointerId: number;
  sequence: number;
  readonly events: PendingDragEvent[];
}

/** Buffers pointer delivery while the Main-owned drag session is being created. */
export class PetDragController {
  private active: ActiveDragSession | null = null;
  private pending: PendingDragSession | null = null;
  private nextToken = 0;

  public constructor(private readonly bridge: PetMainBridge) {}

  public begin(pointerId: number, screenPosition: { readonly x: number; readonly y: number }): boolean {
    if (this.active !== null || this.pending !== null) return false;
    const pending: PendingDragSession = {
      token: ++this.nextToken,
      pointerId,
      sequence: 0,
      events: [],
    };
    this.pending = pending;
    void beginPetDrag(this.bridge, { pointerId, sequence: 0, screenPosition })
      .then(({ dragSessionId }) => this.resolveBegin(pending.token, dragSessionId))
      .catch(() => {
        if (this.pending?.token === pending.token) this.pending = null;
      });
    return true;
  }

  public move(screenPosition: { readonly x: number; readonly y: number }): boolean {
    if (this.active !== null) {
      this.active.sequence += 1;
      void movePetDrag(this.bridge, {
        dragSessionId: this.active.id,
        pointerId: this.active.pointerId,
        sequence: this.active.sequence,
        screenPosition,
      });
      return true;
    }
    if (this.pending === null || this.hasPendingRelease()) return false;
    this.pending.sequence += 1;
    this.pending.events.push({ type: 'move', sequence: this.pending.sequence, screenPosition });
    return true;
  }

  public release(screenPosition: { readonly x: number; readonly y: number }): boolean {
    if (this.active !== null) {
      this.active.sequence += 1;
      void releasePetDrag(this.bridge, {
        dragSessionId: this.active.id,
        pointerId: this.active.pointerId,
        sequence: this.active.sequence,
        screenPosition,
      });
      this.active = null;
      return true;
    }
    if (this.pending === null || this.hasPendingRelease()) return false;
    this.pending.sequence += 1;
    this.pending.events.push({ type: 'release', sequence: this.pending.sequence, screenPosition });
    return true;
  }

  private resolveBegin(token: number, dragSessionId: string): void {
    const pending = this.pending;
    if (pending === null || pending.token !== token) return;
    this.pending = null;
    this.active = { id: dragSessionId, pointerId: pending.pointerId, sequence: 0 };
    for (const event of pending.events) {
      this.active.sequence = event.sequence;
      if (event.type === 'move') {
        void movePetDrag(this.bridge, {
          dragSessionId, pointerId: pending.pointerId, sequence: event.sequence, screenPosition: event.screenPosition,
        });
      } else {
        void releasePetDrag(this.bridge, {
          dragSessionId, pointerId: pending.pointerId, sequence: event.sequence, screenPosition: event.screenPosition,
        });
        this.active = null;
        return;
      }
    }
  }

  private hasPendingRelease(): boolean {
    return this.pending?.events.some((event) => event.type === 'release') ?? false;
  }
}

export class PetPresentationRevisionGate {
  private revision = -1;

  public accept(state: PetPresentationStateDTO): boolean {
    if (state.revision <= this.revision) return false;
    this.revision = state.revision;
    return true;
  }
}
