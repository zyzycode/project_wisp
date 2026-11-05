import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

/** Closed text-discussion catalogue; never a claim of hearing music. */
export type MusicTopicId = 'jazz' | 'classical' | 'rock' | 'electronic';
export interface MusicDialogueSource {
  readonly conversationSessionId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
  readonly revision: 1;
}
export interface MusicDiscussionSample {
  readonly topic: MusicTopicId;
  readonly intention: 'ask_music_detail';
  readonly opening: MusicDialogueSource;
  readonly continuation: MusicDialogueSource;
  readonly occurredAt: string;
}
export interface MusicUserPreference {
  readonly topic: MusicTopicId;
  readonly disposition: 'like' | 'dislike';
  readonly source: MusicDialogueSource;
  readonly occurredAt: string;
}
/** Read validates all sources/TTL; at most48 samples and4 current user preferences. */
export interface MusicInterestEvidence {
  readonly samples: readonly MusicDiscussionSample[];
  readonly userPreferences: readonly MusicUserPreference[];
}
/** Target #179: same SQLite worker, no replay producer or provider extraction. */
export interface IMusicInterestRepository {
  read(now: string, context: MemoryOperationContext): Promise<MemoryResult<MusicInterestEvidence>>;
  appendSample(sample: MusicDiscussionSample, now: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  replaceUserPreference(preference: MusicUserPreference, now: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}
