/** Local knowledge/recall boundary. Rules: MEMORY_ENGINE §9, P15_A02_RESULT. */
import type { GameEpisode, MemoryOperationContext, MemoryResult } from './memory-repository.interface';

export type MemoryFactKey =
  | 'user.display_name' | 'user.preferred_address' | 'user.favorite_topic'
  | 'user.reply_style' | 'user.cursor_game';

/** Untrusted semantic proposal. Only the current user message can be evidence. */
export interface MemoryFactCandidate {
  readonly key: MemoryFactKey;
  readonly value: string;
  readonly evidenceQuote: string;
}

export interface RecalledDialogueEpisode {
  readonly kind: 'dialogue';
  readonly userText: string;
  readonly assistantText: string;
  readonly occurredAt: string;
}

export interface RecalledCursorGameEpisode {
  readonly kind: 'cursor_game';
  readonly outcome: GameEpisode['outcome'];
  readonly executedMs: number;
  readonly occurredAt: string;
}

export type RecalledMemoryEpisode = RecalledDialogueEpisode | RecalledCursorGameEpisode;

/** Provider-neutral, explicitly bounded projection; no SQL or storage record IDs. */
export interface AIProviderMemoryContext {
  readonly facts: readonly { readonly key: MemoryFactKey; readonly value: string }[];
  readonly episodes: readonly RecalledMemoryEpisode[];
  readonly characterPreferences: readonly {
    readonly key: 'activity.cursor_game';
    readonly value: number;
    readonly confidence: number;
  }[];
}

export interface MemoryRecallQuery {
  readonly text: string;
  /** Internal social-event retrieval uses the current saved topic without another read. */
  readonly useFavoriteTopic?: boolean;
  readonly excludedMessageIds: readonly string[];
}

/** Application implementation composes repositories and deterministic selection. */
export interface ILocalMemoryRecall {
  recall(query: MemoryRecallQuery, context: MemoryOperationContext): Promise<MemoryResult<AIProviderMemoryContext>>;
}

/** Additive reader: #6 writer/worker schema remains valid until #56 adds this operation. */
export interface IGameEpisodeReader {
  /** Limit 1..20; newest first by insertion rowid, which remains private to SQLite. */
  getRecent(limit: number, context: MemoryOperationContext): Promise<MemoryResult<readonly GameEpisode[]>>;
}

/** No text/LLM deltas reach the Character learning boundary. */
export interface VerifiedPreferenceEvidence {
  readonly sourceMessageId: string;
  readonly key: 'activity.cursor_game';
  readonly disposition: 'like' | 'dislike';
}

export interface ICharacterPreferenceLearning {
  /** Called only for the current, persisted, source-validated user turn; never on restore. */
  observe(evidence: VerifiedPreferenceEvidence): void;
}
