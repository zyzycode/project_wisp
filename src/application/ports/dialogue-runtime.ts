import type { IAIProvider } from './ai-provider.interface';
import type { CharacterSnapshot, CharacterStimulus } from '../../domain/character';
import type { ProviderBehaviorOffer, BehaviorAdmissionReceipt, BehaviorTurnContext } from './behavior-admission-port';

/** All effects are injected by Main; provider execution belongs to one app lifecycle. */
export interface DialogueRuntimeOptions {
  readonly provider: IAIProvider;
  readonly now: () => number;
  readonly timestamp: () => string;
  readonly createId: () => string;
  readonly scheduler: { setTimeout(callback: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  readonly getCharacterSnapshot: () => CharacterSnapshot;
  readonly applyStimulus: (stimulus: CharacterStimulus) => void;
  readonly beginThinking: (requestId: string) => void;
  readonly endThinking: (requestId: string) => void;
  readonly setBehaviorContext?: (context: BehaviorTurnContext | null) => void;
  readonly offerIntent: (offer: ProviderBehaviorOffer) => BehaviorAdmissionReceipt;
  readonly transaction: (commit: () => void) => void;
  readonly publish: () => void;
  readonly locale?: string;
}
