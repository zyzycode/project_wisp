import type { CausalLifeSourceReference } from './causal-life.interface';
import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

/** MIND-A01 target; an attributed report about one event, never a user trait. */
export interface InterruptionClarificationSource {
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly revision: 1;
  readonly report: 'accidental' | 'deliberate';
}

export interface SocialInterpretation {
  readonly revision: number;
  readonly episode: CausalLifeSourceReference;
  readonly status: 'unknown' | 'reported_accidental' | 'reported_deliberate' | 'contradicted';
  /** At most two distinct committed user messages; no copied dialogue text. */
  readonly reports: readonly InterruptionClarificationSource[];
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** Compare-and-set and source validation share the existing worker transaction. */
export interface ISocialInterpretationRepository {
  read(context: MemoryOperationContext): Promise<MemoryResult<SocialInterpretation | null>>;
  replace(
    value: SocialInterpretation,
    expectedRevision: number | null,
    context: MemoryOperationContext,
  ): Promise<MemoryResult<void>>;
  clear(expectedRevision: number, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

/** Volatile decision passed to the existing Utility, not another execution owner. */
export interface CopingOpportunity {
  readonly source: CausalLifeSourceReference;
  readonly strategy: 'pause' | 'explore';
  readonly expiresAtMs: number;
}
