import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';
import type { BackendMusicTopicContext } from './backend-music-interest-contract';
import type { MusicMessage } from '../../domain/character/music-interest';

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
/** Existing SQLite worker; no replay producer or provider extraction. */
export interface IMusicInterestRepository {
  read(now: string, context: MemoryOperationContext): Promise<MemoryResult<MusicInterestEvidence>>;
  appendSample(sample: MusicDiscussionSample, now: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
  replaceUserPreference(preference: MusicUserPreference, now: string, context: MemoryOperationContext): Promise<MemoryResult<void>>;
}

/** Volatile local receipt, never an IPC/wire field or a replay producer. */
export interface MusicTurnAdmission {
  readonly epoch: number;
  readonly serial: number;
  readonly conversationId: string;
  readonly admittedAtMs: number;
  readonly message?: MusicMessage;
  readonly opening?: MusicDialogueSource;
  readonly openingDeadlineMs?: number;
}
export interface MusicContextCapture {
  readonly admission: MusicTurnAdmission;
  readonly memoryGeneration: number;
  readonly sourceRevision: number;
  readonly context: BackendMusicTopicContext;
}
export interface MusicPublishedReceipt {
  readonly admission: MusicTurnAdmission;
  readonly success: boolean;
  readonly dispatched: boolean;
  readonly intention: boolean;
  readonly discussionAllowed: boolean;
}
export interface IMusicInterestRuntime {
  beginTurn(conversationId: string, text: string): MusicTurnAdmission;
  prepare(admission: MusicTurnAdmission, generation: number, gates: { readonly causal: boolean; readonly otherBundle: boolean; readonly deadlineMs: number }): Promise<MusicContextCapture | undefined>;
  isCurrent(capture: MusicContextCapture): boolean;
  cancelDialogue(): void;
  invalidate(): void;
}
