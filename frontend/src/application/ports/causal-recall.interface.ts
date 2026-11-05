import type { CausalLifeEpisode, CausalLifeSourceReference } from './causal-life.interface';
import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

/** MEMORY-A01 target; closed causal buckets, not an arbitrary SQL/text query. */
export type CausalRecallKey = 'game.any' | 'game.user_interrupted' | 'game.timeout'
  | 'game.environment_lost' | 'game.completed.user_engaged' | 'game.completed.solitary' | 'contact';

export interface CausalRecallQuery {
  readonly key: CausalRecallKey;
  readonly before: string;
  readonly exclude?: CausalLifeSourceReference;
}

export interface CausalRecallCandidate {
  readonly source: CausalLifeSourceReference;
  readonly episode: CausalLifeEpisode;
  readonly match: 'exact_causal_bucket';
}

export interface CausalRecallPage {
  /** Newest insertion first, at most16; sources revalidated before projection. */
  readonly candidates: readonly CausalRecallCandidate[];
  readonly coverage: 'complete' | 'index_building';
}

export interface ICausalLifeRecallReader {
  find(query: CausalRecallQuery, context: MemoryOperationContext): Promise<MemoryResult<CausalRecallPage>>;
}
