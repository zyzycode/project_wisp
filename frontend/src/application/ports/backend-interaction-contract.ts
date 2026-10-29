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
  readonly card: { readonly id: 'curiousStubbornGirl'; readonly revision: 3 };
  readonly effectPolicy: 'eligible' | 'suppressed';
}

/** Untrusted quotation of an explicitly selected user statement; not a memory fact. */
export interface BackendDialogueTopic {
  readonly mode: 'follow_up' | 'reply';
  readonly text: string;
  readonly statedAt: string;
}

/** Conditional ordinary-chat context; wire-only, no local IDs. */
export interface BackendBeveragePreference {
  readonly allowProposal: boolean;
  readonly current?: { readonly value: 'coffee' | 'tea'; readonly validity: 'hypothesis' | 'confirmed' };
}
export interface BackendBeverageProposal {
  readonly value: 'coffee' | 'tea';
  readonly evidenceQuote: string;
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
    readonly dialogueTopic?: BackendDialogueTopic;
    readonly beveragePreference?: BackendBeveragePreference;
  };

export type BackendInteractionChatResponse = BackendSummaryChatResponse & {
  readonly appraisal: BackendInteractionAppraisal;
  readonly beverageProposal?: BackendBeverageProposal;
};

export interface BackendInteractionErrorResponse {
  readonly requestId: string | null;
  readonly error: { readonly code: BackendAIErrorCode; readonly retryAfterMs?: number };
}
