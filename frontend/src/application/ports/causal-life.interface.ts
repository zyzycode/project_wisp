import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';
import type { CharacterMemoryStateV2 } from './character-memory-snapshot';

/** Target CE-A01 boundary. Runtime reducers and SQLite adapters are separate slices. */
export interface CausalLifeEpisode {
  readonly appRunId: string;
  readonly sequence: number;
  readonly revision: 1;
  readonly occurredAt: string;
  readonly source: 'user' | 'system' | 'autonomy' | 'unknown';
  /** Accepted input sequence in the same appRun; null when no input caused this fact. */
  readonly triggerSequence: number | null;
  readonly activityRunId: string | null;
  readonly activity: 'cursor_game' | null;
  readonly outcome: 'completed' | 'cancelled' | 'failed' | null;
  readonly terminalReason: 'forced_motion' | 'user_interaction' | 'critical_need'
    | 'higher_priority_activity' | 'environment_invalidated' | 'animation_rejected'
    | 'step_timeout' | 'explicit_cancel' | 'application_shutdown'
    | 'invalid_definition' | 'unresolved_target' | null;
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout' | 'other' | 'unknown';
  readonly executedMs: number;
  readonly participation: 'user_engaged' | 'solitary' | 'none';
}

export type CausalRelationshipFacets = {
  readonly familiarity: number;
  readonly trust: number;
  readonly affection: number;
  readonly respect: number;
  readonly resentment: number;
  readonly comfort: number;
};

/** One volatile local decision; the model receives only the separately bounded wire projection. */
export interface CausalEmotionSnapshot {
  readonly causeSequence: number;
  readonly kind: 'content' | 'curious' | 'irritated';
  readonly intensity: number;
  readonly target: 'user' | 'environment' | 'self';
}

/** Target #161 wire projection; has no local IDs, timers, source text or numeric writes. */
export interface CausalExpressionProjection {
  readonly intent: 'respond' | 'acknowledge' | 'give_space' | 'continue_activity';
  readonly emotion: CausalEmotionSnapshot['kind'];
  readonly intensity: 'low' | 'moderate';
  readonly target: CausalEmotionSnapshot['target'];
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout';
  readonly deferredInvitation: boolean;
  readonly ownGameInterest: 'none' | 'emerging' | 'established';
}

export interface ICausalLifeRepository {
  /** Exact same appRunId/sequence and payload is a no-op; another payload conflicts. */
  append(episode: CausalLifeEpisode, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  /** Indexed insertion-order suffix, oldest-first, validated limit 1..100. */
  getRecent(limit: number, context: MemoryOperationContext): Promise<MemoryResult<readonly CausalLifeEpisode[]>>;
  /** Exact indexed identities, at most20, no transcript scan; absent sources are omitted. */
  resolveSources(sources: readonly CausalLifeSourceReference[], context: MemoryOperationContext): Promise<MemoryResult<readonly CausalLifeEpisode[]>>;
}

export type CausalLifeSourceReference = {
  readonly appRunId: string;
  readonly sequence: number;
  readonly revision: 1;
};

export interface CharacterMemorySnapshotV3 {
  readonly snapshotVersion: 3;
  readonly updatedAt: string;
  readonly state: Omit<CharacterMemoryStateV2, 'relationship'> & {
    readonly relationship: CharacterMemoryStateV2['relationship'] & CausalRelationshipFacets;
    readonly ownGameInterestSources: readonly CausalLifeSourceReference[];
  };
}

export interface DeferredGameInvitation {
  readonly id: string;
  readonly sourceAppRunId: string;
  readonly sourceSequence: number;
  readonly createdAt: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly state: 'pending' | 'claimed' | 'completed' | 'cancelled' | 'expired' | 'abandoned';
}

export interface IDeferredGameInvitationRepository {
  /** Atomically create at most one pending invitation from a committed completed source. */
  create(invitation: DeferredGameInvitation, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  read(now: string, context: MemoryOperationContext): Promise<MemoryResult<DeferredGameInvitation | null>>;
  /** Compare-and-set plus current source validation; only an acknowledged claim permits admission. */
  claim(id: string, now: string, context: MemoryOperationContext): Promise<MemoryResult<boolean>>;
  finish(id: string, state: 'completed' | 'cancelled' | 'expired' | 'abandoned', context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

/** Successful append of a fresh observed event; reads/restores never invoke this observer. */
export interface ICausalLifeCommitObserver {
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void;
}
