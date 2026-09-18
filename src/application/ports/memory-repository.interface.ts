/** Application-owned persistence boundary. Canonical rules: docs/engine/MEMORY_ENGINE.md.
 * No SQL, filesystem, Electron, worker or provider types cross this boundary.
 */
import type { CursorGameOutcome } from './cursor-game-contract';
import type { CharacterMemorySnapshotV1 } from './character-memory-snapshot';

export type MemoryFailureCode =
  | 'unavailable' | 'busy' | 'storage_full' | 'corrupt' | 'unsupported_version'
  | 'invalid_data' | 'conflict' | 'stale' | 'io_error';

export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MemoryFailureCode };

/** Main/Application generation; checked again at execution by Infrastructure. */
export interface MemoryOperationContext {
  readonly generation: number;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessageDraft {
  readonly conversationSessionId: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface PersistedChatMessage extends ChatMessageDraft {
  readonly id: string;
}

export type ChatMessage = PersistedChatMessage;

export interface ConversationSession {
  readonly id: string;
  readonly appRunId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** A completed, displayed turn; session creation and both messages commit together. */
export interface CompletedChatTurn {
  readonly session: ConversationSession;
  readonly user: PersistedChatMessage & { readonly role: 'user' };
  readonly assistant: PersistedChatMessage & { readonly role: 'assistant' };
}

export interface UserFactDraft {
  readonly factKey: string;
  readonly factValue: string;
  readonly confidence: number;
  readonly sourceMessageId: string | null;
}

export interface UserFact extends UserFactDraft {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Real terminal result, not a generated narrative. Composite key survives run-id reuse. */
export interface GameEpisode {
  readonly appRunId: string;
  readonly activityRunId: string;
  readonly kind: 'cursor_game';
  readonly outcome: CursorGameOutcome;
  readonly playCompleted: true;
  readonly executedMs: number;
  readonly endedAt: string;
}

export type JsonValue =
  | string | number | boolean | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Untrusted versioned envelope; Application migrates and validates before restore. */
export interface PersistedCharacterStateSnapshot {
  readonly snapshotVersion: number;
  readonly state: JsonValue;
  readonly updatedAt: string;
}

export interface IChatHistoryRepository {
  appendTurn(turn: CompletedChatTurn, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  /** Latest messages by insertion order, returned oldest first; limit is 1..100. */
  getRecent(limit: number, context: MemoryOperationContext): Promise<MemoryResult<readonly PersistedChatMessage[]>>;
  closeSession(sessionId: string, endedAt: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  closeUnfinishedSessions(endedAt: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

export interface IUserFactsRepository {
  /** On update preserve the stored id/createdAt; caller supplies candidate id and timestamps. */
  upsert(fact: UserFact, context: MemoryOperationContext): Promise<MemoryResult<UserFact>>;
  removeByKey(factKey: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  /** Stable factKey order; limit is 1..100. */
  list(limit: number, context: MemoryOperationContext): Promise<MemoryResult<readonly UserFact[]>>;
}

export interface IGameEpisodeRepository {
  /** Same composite key + same payload is a no-op; different payload is conflict. */
  append(episode: GameEpisode, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

export interface ICharacterStateRepository {
  load(context: MemoryOperationContext): Promise<MemoryResult<PersistedCharacterStateSnapshot | null>>;
  save(snapshot: CharacterMemorySnapshotV1, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

/** Advances the generation barrier even if deletion rolls back; no per-table clear API. */
export interface IClearMemoryStore {
  clearUserMemory(nextContext: MemoryOperationContext): Promise<MemoryResult<void>>;
}

/** Local Mock context policy; persistent context for a network provider needs #55/#56. */
export interface ChatContextLimits {
  readonly maxMessages: number;
  readonly maxTotalCharacters: number;
  readonly maxCharactersPerMessage: number;
}

export const DEFAULT_CHAT_CONTEXT_LIMITS: ChatContextLimits = {
  maxMessages: 20,
  maxTotalCharacters: 8_000,
  maxCharactersPerMessage: 2_000,
};
