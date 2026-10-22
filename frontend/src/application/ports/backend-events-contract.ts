/** Explicit wire v1. Dependencies below are wire types only. */
import type { BackendAIErrorCode, BackendCharacterContext, BackendAIMessage } from './backend-ai-contract';
import type { BackendMemoryContext, BackendMemoryResponse } from './backend-memory-contract';

export type BackendCompanionEvent =
  | {
      readonly type: 'cursor_game_completed';
      readonly outcome: 'caught' | 'missed' | 'lost_target';
      readonly executedMs: number;
      readonly occurredAt: string;
    }
  | { readonly type: 'social_bid_started'; readonly occurredAt: string };

export interface BackendEventRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly event: BackendCompanionEvent;
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly memory: BackendMemoryContext;
}

export interface BackendEventResponse {
  readonly version: 1;
  readonly requestId: string;
  readonly text: string;
}

export interface BackendPreviousInitiative {
  readonly kind: 'cursor_game' | 'social_bid';
  readonly text: string;
  readonly createdAt: string;
}

/** v1 user-message semantics plus one explicitly sourced preceding initiative. */
export interface BackendEventAwareChatRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly event: { readonly type: 'user_message' };
  readonly messages: readonly BackendAIMessage[];
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly memory: BackendMemoryContext;
  readonly previousInitiative?: BackendPreviousInitiative;
}

export type BackendEventAwareChatResponse = BackendMemoryResponse;

export interface BackendEventErrorResponse {
  readonly version: 1;
  readonly requestId: string | null;
  readonly error: { readonly code: BackendAIErrorCode; readonly retryAfterMs?: number };
}
