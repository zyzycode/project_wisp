/**
 * Application Port: Memory Storage & Repositories
 * Defines the typed boundary between Project Wisp application layer
 * and local offline persistence (SQLite / in-memory adapters).
 *
 * Rules:
 * - Pure TypeScript interfaces and types only.
 * - No SQLite, better-sqlite3, or Node.js filesystem dependencies.
 * - All timestamps are ISO-8601 UTC strings.
 * - Invariant: memory belongs to Main process, Renderer has zero access to DB handles.
 * - Source of truth: docs/engine/MEMORY_ENGINE.md
 */

/** Allowed chat roles for MVP public API. */
export type ChatRole = 'user' | 'assistant';

/** Message before identifier assignment and persistence. */
export interface ChatMessageDraft {
  conversationSessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

/** Persisted entity: a message always belongs to a single session. */
export interface PersistedChatMessage extends ChatMessageDraft {
  id: string;
}

/** Canonical alias matching docs/engine/MEMORY_ENGINE.md */
export type ChatMessage = PersistedChatMessage;

export interface ConversationSession {
  id: string;
  appRunId: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
}

export interface UserFactDraft {
  factKey: string;
  factValue: string;
  confidence: number;
  sourceMessageId: string | null;
}

export interface UserFact extends UserFactDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryType = 'event' | 'experience' | 'relationship';

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  sourceMessageId: string | null;
  createdAt: string;
  lastAccessedAt: string;
  eventAt: string | null;
  expiresAt: string | null;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface PersistedCharacterStateSnapshot {
  /** Format snapshot_json; SQLite does not interpret payload. */
  snapshotVersion: number;
  state: JsonValue;
  updatedAt: string;
}

export interface IChatHistoryRepository {
  append(message: PersistedChatMessage): Promise<void>;
  getRecent(limit: number): Promise<PersistedChatMessage[]>;
  createSession(session: ConversationSession): Promise<void>;
  closeSession(sessionId: string, endedAt: string): Promise<void>;
  closeUnfinishedSessions(endedAt: string): Promise<void>;
  setSessionSummary(sessionId: string, summary: string | null): Promise<void>;
  clear(): Promise<void>;
}

export interface IUserFactsRepository {
  upsert(fact: UserFactDraft): Promise<UserFact>;
  removeByKey(factKey: string): Promise<void>;
  list(limit: number): Promise<UserFact[]>;
  clear(): Promise<void>;
}

export interface ICharacterStateRepository {
  load(): Promise<PersistedCharacterStateSnapshot | null>;
  save(snapshot: PersistedCharacterStateSnapshot): Promise<void>;
  clear(): Promise<void>;
}

/** Narrow transactional boundary used exclusively by ClearMemoryUseCase. */
export interface IClearMemoryStore {
  clearUserMemory(): Promise<void>;
}

export interface ChatContextLimits {
  readonly maxRecentMessages: number;
  readonly maxUserFacts: number;
}
