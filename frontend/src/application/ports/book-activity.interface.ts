import type { CausalEmotionSnapshot, CausalLifeEpisode, CausalLifeSourceReference, CharacterMemorySnapshotV5 } from './causal-life.interface';

/** Target #183: decorative session, no document/content access or reading progress. */
export type BookActivityPhase = 'settle' | 'with_book' | 'finish';
/** Volatile current-cause metadata, copied from observed event without a DB lookup. */
export interface BookCompatibleCausalEmotionSnapshot extends CausalEmotionSnapshot {
  readonly activity: 'contact' | 'cursor_game' | 'book';
}
export interface BookBodyHintDTO {
  readonly activity: 'book';
  readonly phase: BookActivityPhase;
  /** A semantic request; Skin resolves absent human-authored prop to none. */
  readonly propHint: 'book' | 'none';
}
export interface BookCausalLifeEpisode extends Omit<CausalLifeEpisode, 'activity' | 'participation' | 'cause' | 'activityRunId' | 'outcome'> {
  readonly activity: 'book';
  readonly participation: 'solitary';
  readonly cause: Exclude<CausalLifeEpisode['cause'], 'contact'>;
  readonly activityRunId: string;
  readonly outcome: 'completed' | 'cancelled' | 'failed';
}
/** Target union only; active recorder/repository rollout is atomic in #183. */
export type BookCompatibleCausalLifeEpisode = CausalLifeEpisode | BookCausalLifeEpisode;
export interface CharacterMemorySnapshotV6 {
  readonly snapshotVersion: 6;
  readonly updatedAt: string;
  readonly state: CharacterMemorySnapshotV5['state'] & {
    /** At most20 exact acknowledged completed book-session sources, no content. */
    readonly ownBookInterestSources: readonly CausalLifeSourceReference[];
  };
}
