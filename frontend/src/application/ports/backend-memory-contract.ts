/** Explicit wire v2 extension. Imports are wire-only; local memory DTOs are independent. */
import type {
  BackendAIBehavior, BackendAITone, BackendAIMood, BackendCharacterContext,
  BackendAIErrorCode, BackendAIMessage,
} from './backend-ai-contract';

export type BackendMemoryFactKey =
  | 'user.display_name' | 'user.preferred_address' | 'user.favorite_topic'
  | 'user.reply_style' | 'user.cursor_game';

export interface BackendMemoryFact {
  readonly key: BackendMemoryFactKey;
  readonly value: string;
}

export type BackendMemoryEpisode =
  | { readonly kind: 'dialogue'; readonly userText: string; readonly assistantText: string; readonly occurredAt: string }
  | {
      readonly kind: 'cursor_game';
      readonly outcome: 'caught' | 'missed' | 'lost_target' | 'cancelled';
      readonly executedMs: number;
      readonly occurredAt: string;
    };

export interface BackendMemoryContext {
  readonly facts: readonly BackendMemoryFact[];
  readonly episodes: readonly BackendMemoryEpisode[];
  readonly characterPreferences: readonly {
    readonly key: 'activity.cursor_game';
    readonly value: number;
    readonly confidence: number;
  }[];
}

export interface BackendMemoryRequest {
  readonly version: 2;
  readonly requestId: string;
  readonly event: { readonly type: 'user_message' };
  readonly messages: readonly BackendAIMessage[];
  readonly stream: false;
  readonly locale: 'ru' | 'en';
  readonly character: BackendCharacterContext;
  readonly memory: BackendMemoryContext;
}

export interface BackendMemoryCandidate extends BackendMemoryFact {
  readonly evidenceQuote: string;
}

export interface BackendMemoryResponse {
  readonly version: 2;
  readonly requestId: string;
  readonly text: string;
  readonly decision?: {
    readonly behavior: BackendAIBehavior;
    readonly tone?: BackendAITone;
    readonly mood?: BackendAIMood;
    readonly confidence: number;
  };
  readonly memoryCandidates?: readonly BackendMemoryCandidate[];
}

export interface BackendMemoryErrorResponse {
  readonly version: 2;
  readonly requestId: string | null;
  readonly error: { readonly code: BackendAIErrorCode; readonly retryAfterMs?: number };
}
