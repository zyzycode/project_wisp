/** P17-A04 semantic events; no transport, SQL, animation or physical commands. */
import type { AIProviderCharacterSnapshot } from './ai-provider.interface';
import type { AIProviderMemoryContext } from './memory-knowledge.interface';
import type { AIRequestAvailability, IAIRequestControl } from './ai-request-policy';
import type { GameEpisode, MemoryOperationContext } from './memory-repository.interface';

export type AICompanionEvent =
  | {
      readonly type: 'cursor_game_completed';
      readonly outcome: 'caught' | 'missed' | 'lost_target';
      readonly executedMs: number;
      readonly occurredAt: string;
    }
  | { readonly type: 'social_bid_started'; readonly occurredAt: string };

export interface AIEventProviderRequest {
  readonly requestId: string;
  readonly event: AICompanionEvent;
  readonly characterSnapshot: AIProviderCharacterSnapshot;
  readonly memoryContext: AIProviderMemoryContext;
  readonly locale: 'ru' | 'en';
}

export interface AIEventProviderResponse {
  readonly requestId: string;
  readonly replyText: string;
}

export interface IAIEventProvider {
  generateEvent(request: AIEventProviderRequest): Promise<AIEventProviderResponse>;
  /** Idempotent cancellation of this request only; generation checks remain mandatory. */
  cancel(requestId: string): void;
}

/** The dialogue runtime awaits transport settlement before starting its own HTTP call. */
export interface IAIEventInterlock {
  interruptForUser(): Promise<void>;
}

/** The same instance also serves dialogue: shared 6/min and 100/session counters. */
export interface IAIEventRequestControl extends IAIRequestControl {
  eventAvailability(nowMs: number): AIRequestAvailability;
  /** Atomically charges common counters and the stricter event sub-budget. */
  recordEventSubmission(nowMs: number): boolean;
}

/** Additional observer after durable commit; no-op writes can repeat, observer dedupes. */
export interface IGameEpisodeCommitObserver {
  committed(episode: GameEpisode, context: MemoryOperationContext): void;
}
