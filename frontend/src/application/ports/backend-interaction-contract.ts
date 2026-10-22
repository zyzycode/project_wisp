/** Explicit wire v1; imports only other wire contracts, never local semantic DTOs. */
import type { BackendAIErrorCode, BackendCharacterContext } from './backend-ai-contract';
import type { BackendSummaryChatRequest, BackendSummaryChatResponse } from './backend-summary-contract';

export interface BackendInteractionAppraisal {
  readonly category: 'supportive' | 'playful' | 'boundary' | 'hostile' | 'neutral';
  readonly intensity: 'low' | 'moderate';
  readonly confidence: 'clear' | 'uncertain';
}

export interface BackendPreviousTouchReaction {
  readonly action: 'touch';
  readonly occurredAt: string;
  readonly publishedText: string;
  readonly appraisal: BackendInteractionAppraisal;
  readonly effect: 'accepted' | 'neutral' | 'suppressed' | 'rejected';
  readonly reason: 'applied' | 'uncertain' | 'cooldown' | 'state_changed' | 'unavailable' | 'neutral';
  readonly energyBand: 'tired' | 'rested';
  readonly comfortBand: 'overloaded' | 'calm';
}

export interface BackendInteractionPolicy {
  readonly card: { readonly id: 'shyDreamGirl'; readonly revision: 1 };
  readonly effectPolicy: 'eligible' | 'suppressed';
}

export interface BackendInteractionTouchRequest extends BackendInteractionPolicy {
  readonly requestId: string;
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly event: { readonly type: 'user_touch'; readonly variant: 'touch' };
}

export interface BackendInteractionTouchResponse {
  readonly requestId: string;
  readonly text: string;
  readonly appraisal: BackendInteractionAppraisal;
}

export type BackendInteractionChatRequest = BackendSummaryChatRequest &
  BackendInteractionPolicy & {
    readonly previousTouch?: BackendPreviousTouchReaction;
  };

export type BackendInteractionChatResponse = BackendSummaryChatResponse & {
  readonly appraisal: BackendInteractionAppraisal;
};

export interface BackendInteractionErrorResponse {
  readonly requestId: string | null;
  readonly error: { readonly code: BackendAIErrorCode; readonly retryAfterMs?: number };
}
