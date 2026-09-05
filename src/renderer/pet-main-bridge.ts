import type {
  BeginPetDragDTO,
  BeginPetDragResultDTO,
  BrainStateDTO,
  BrainVisualIntentDTO,
  MovePetDragDTO,
  ReleasePetDragDTO,
  SleepWakeCommandDTO,
  WispApiBridge,
} from '../shared/ipc-contracts';
import { parseBrainStateDTO } from '../shared/brain-body-ipc-validation';
import type { AnimationIntent } from '../domain/animation/animation-intent';

export type PetMainBridge = Pick<
  WispApiBridge,
  'beginPetDrag' | 'movePetDrag' | 'releasePetDrag' | 'onBrainState'
>;

export function subscribeToBrainState(
  bridge: PetMainBridge,
  listener: (state: BrainStateDTO) => void
): () => void {
  return bridge.onBrainState(listener);
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

export function requestCharacterSleepWake(
  bridge: Pick<WispApiBridge, 'requestSleepWake'>,
  action: SleepWakeCommandDTO['action']
): Promise<void> {
  return bridge.requestSleepWake({ action });
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

const MAX_PROTOCOL_DIAGNOSTICS = 10;

export class BrainStateRevisionGate {
  private streamId: string | null = null;
  private revision = 0;
  private currentEpisodeId: string | null = null;
  private readonly visualPayloads = new Map<string, string>();
  private diagnosticCount = 0;

  public constructor(private readonly reportDiagnostic: (message: string) => void = console.warn) {}

  public accept(payload: unknown): BrainStateDTO | null {
    let state: BrainStateDTO;
    try {
      state = parseBrainStateDTO(payload);
    } catch {
      this.diagnostic('Rejected malformed Brain snapshot');
      return null;
    }
    if (this.streamId === null) this.streamId = state.streamId;
    if (state.streamId !== this.streamId || state.revision <= this.revision) {
      this.diagnostic('Rejected stale or foreign Brain snapshot');
      return null;
    }

    const episodeId = state.visualIntent.episodeId;
    const signature = JSON.stringify(state.visualIntent);
    const knownSignature = this.visualPayloads.get(episodeId);
    if (
      (knownSignature !== undefined && knownSignature !== signature) ||
      (knownSignature !== undefined && episodeId !== this.currentEpisodeId)
    ) {
      this.diagnostic('Rejected reused or mutated Brain visual episode');
      return null;
    }
    if (knownSignature === undefined) this.visualPayloads.set(episodeId, signature);
    this.currentEpisodeId = episodeId;
    this.revision = state.revision;
    return state;
  }

  private diagnostic(message: string): void {
    if (this.diagnosticCount >= MAX_PROTOCOL_DIAGNOSTICS) return;
    this.diagnosticCount += 1;
    this.reportDiagnostic(message);
  }
}

export function toAnimationIntent(
  visualIntent: BrainVisualIntentDTO
): AnimationIntent<BrainVisualIntentDTO['kind']> {
  return {
    kind: visualIntent.kind,
    category: visualIntent.category,
    priority: visualIntent.priority,
    interrupt: visualIntent.interrupt,
    loop: visualIntent.loop,
    requestedBy: 'brain',
    emotionalTone: visualIntent.emotionalTone,
    ...(visualIntent.expressionHint === undefined
      ? {}
      : { expressionHint: visualIntent.expressionHint }),
    ...(visualIntent.gazeDirection === undefined
      ? {}
      : { gazeDirection: visualIntent.gazeDirection }),
    ...(visualIntent.propHint === undefined ? {} : { propHint: visualIntent.propHint }),
  };
}
