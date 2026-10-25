import type { InteractionAppraisal, PreviousTouchReaction, InteractionReceipt } from './interaction-appraisal';
import type { DialogueMemoryHooks } from './memory-runtime';
import type { IAIProvider } from './ai-provider.interface';
import type { CharacterSnapshot, CharacterStimulus } from '../../domain/character';
import type { ProviderBehaviorOffer, BehaviorAdmissionReceipt, BehaviorTurnContext } from './behavior-admission-port';

/** Main-session ownership; never persisted or sent to a provider.
 * Dialogue reset/stream replacement does not release this gate. Admission and late
 * publication share isActive(); explicit user dialogue resumes before its turn.
 */
export interface IQuietSupportRuntime {
  isActive(): boolean;
  enter(): void;
  resumeForUserDialogue(): void;
  resetMemory(): void;
  dispose(): void;
}

/** All effects are injected by Main; provider execution belongs to one app lifecycle. */
export interface DialogueRuntimeOptions {
  readonly provider: IAIProvider;
  readonly quietSupport?: IQuietSupportRuntime;
  readonly interactionEnabled?: boolean;
  readonly beginInteraction?: () => InteractionReceipt;
  readonly commitInteraction?: (receipt: InteractionReceipt, proposal?: InteractionAppraisal) => Pick<PreviousTouchReaction, 'effect' | 'reason'>;
  readonly observation?: import('./ai-event-provider.interface').IAIEventInterlock & { reset(): void; invalidate(): void };
  readonly events?: import('./ai-event-provider.interface').IAIEventInterlock & {
    suppressUnsolicited?(): void;
    getPreviousTouch?(): import('./interaction-appraisal').PreviousTouchReaction | undefined;
    takePreviousInitiative(): import('./ai-provider.interface').AIProviderRequest['previousInitiative'];
    invalidate(): void;
  };
  readonly memory?: DialogueMemoryHooks;
  readonly summary?: import('./summary').ISummaryRuntime;
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
