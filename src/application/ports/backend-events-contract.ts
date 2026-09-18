/** Explicit wire v3. Dependencies below are independently versioned wire types only. */
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
  readonly version: 3;
  readonly requestId: string;
  readonly event: BackendCompanionEvent;
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly memory: BackendMemoryContext;
}

export interface BackendEventResponse {
  readonly version: 3;
  readonly requestId: string;
  readonly text: string;
}

export interface BackendPreviousInitiative {
  readonly kind: 'cursor_game' | 'social_bid';
  readonly text: string;
  readonly createdAt: string;
}

/** V2 user-message semantics plus one explicitly sourced preceding initiative. */
export interface BackendEventAwareChatRequest {
  readonly version: 3;
  readonly requestId: string;
  readonly event: { readonly type: 'user_message' };
  readonly messages: readonly BackendAIMessage[];
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly memory: BackendMemoryContext;
  readonly previousInitiative?: BackendPreviousInitiative;
}

export type BackendEventAwareChatResponse = Omit<BackendMemoryResponse, 'version'> & { readonly version: 3 };

export interface BackendEventErrorResponse {
  readonly version: 3;
  readonly requestId: string | null;
  readonly error: { readonly code: BackendAIErrorCode; readonly retryAfterMs?: number };
}
