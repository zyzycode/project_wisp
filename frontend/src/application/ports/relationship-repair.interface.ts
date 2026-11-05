import type { CausalLifeSourceReference } from './causal-life.interface';

/** MIND-I03 checkpoint metadata, never dialogue evidence or a replay cursor. */
export interface RelationshipRepairCheckpoint {
  /** Timestamp/reference pairs are either both present or both null. */
  readonly lastInterruptionAt: string | null;
  readonly lastInterruptionSource: CausalLifeSourceReference | null;
  readonly lastRepairAt: string | null;
  /** The acknowledged completed game, not the preceding interruption. */
  readonly lastRepairSource: CausalLifeSourceReference | null;
}
