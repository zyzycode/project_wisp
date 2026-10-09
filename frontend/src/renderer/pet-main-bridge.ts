import type {
  BrainStateDTO,
  BrainVisualIntentDTO,
  BodyEventDTO,
  SleepWakeCommandDTO,
  WispApiBridge,
} from '../shared/ipc-contracts';
import { parseBrainStateDTO } from '../shared/brain-body-ipc-validation';
import type { AnimationIntent } from '../domain/animation/animation-intent';

export type PetMainBridge = Pick<
  WispApiBridge,
  'onBrainState' | 'postBodyEvent'
>;

export function subscribeToBrainState(
  bridge: PetMainBridge,
  listener: (state: BrainStateDTO) => void
): () => void {
  return bridge.onBrainState(listener);
}

export function postBodyEvent(bridge: PetMainBridge, event: BodyEventDTO): Promise<void> {
  return bridge.postBodyEvent(event);
}

export function requestCharacterSleepWake(
  bridge: Pick<WispApiBridge, 'requestSleepWake'>,
  action: SleepWakeCommandDTO['action']
): Promise<void> {
  return bridge.requestSleepWake({ action });
}

const MAX_PROTOCOL_DIAGNOSTICS = 10;

export class BrainStateRevisionGate {
  private streamId: string | null = null;
  private revision = 0;
  private currentEpisodeId: string | null = null;
  private episodeSequence = 0;
  private visualPayload: string | null = null;
  private diagnosticCount = 0;

  public constructor(private readonly reportDiagnostic: (message: string) => void = console.warn) {}

  public reset(): void {
    this.streamId = null;
    this.revision = 0;
    this.currentEpisodeId = null;
    this.episodeSequence = 0;
    this.visualPayload = null;
    this.diagnosticCount = 0;
  }

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
    const sequence = state.visualIntent.episodeSequence;
    if (
      sequence < this.episodeSequence ||
      (sequence === this.episodeSequence && signature !== this.visualPayload) ||
      (sequence > this.episodeSequence && episodeId === this.currentEpisodeId)
    ) {
      this.diagnostic('Rejected reused or mutated Brain visual episode');
      return null;
    }
    this.visualPayload = signature;
    this.episodeSequence = sequence;
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
