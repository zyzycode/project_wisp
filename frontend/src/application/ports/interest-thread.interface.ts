/** One explicitly confirmed dialogue topic. Canonical lifecycle: MEMORY_ENGINE §14. */
import type { MemorySourcePair } from './memory-items.interface';
import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

export interface InterestThreadRef {
  readonly threadId: string;
  readonly revision: number;
}

/** Only this projection may reach an ordinary chat provider; no local identifiers. */
export interface AIProviderDialogueTopic {
  readonly mode: 'follow_up' | 'reply';
  readonly text: string;
  readonly statedAt: string;
}

export interface InterestThreadAttempt {
  readonly requestId: string;
  readonly userMessageId: string;
  readonly attemptedAt: string;
}

interface InterestThreadBase {
  readonly ref: InterestThreadRef;
  readonly source: MemorySourcePair;
  readonly statedAt: string;
  readonly confirmedAt: string;
  readonly eligibleAt: string;
  readonly expiresAt: string;
  readonly attempt: InterestThreadAttempt | null;
}

export type InterestThread = InterestThreadBase & (
  | { readonly state: 'unanswered'; readonly text: string }
  | { readonly state: 'answered'; readonly text: null; readonly answerSource: MemorySourcePair }
  | { readonly state: 'closed'; readonly text: null; readonly reason: 'declined' | 'dismissed' | 'expired' | 'source_changed' }
);

export type InterestThreadMutation =
  | {
      readonly kind: 'confirm'; readonly commandId: string; readonly threadId: string;
      /** Explicit replacement, including replacement of a terminal singleton; null only when absent. */
      readonly expected: InterestThreadRef | null; readonly confirmed: true;
      readonly source: MemorySourcePair; readonly text: string;
      readonly confirmedAt: string;
    }
  | {
      readonly kind: 'close'; readonly commandId: string; readonly expected: InterestThreadRef;
      readonly reason: 'declined' | 'dismissed' | 'expired' | 'source_changed';
    }
  | { readonly kind: 'delete'; readonly commandId: string; readonly expected: InterestThreadRef };

export interface InterestThreadReceipt {
  readonly commandId: string;
  readonly ref: InterestThreadRef;
  readonly outcome: 'unanswered' | 'answered' | 'closed' | 'deleted';
}

/** Trusted local association; never inferred from provider output or sent over HTTP. */
export interface InterestThreadTurnUse {
  readonly ref: InterestThreadRef;
  readonly requestId: string;
  readonly userMessageId: string;
  readonly mode: 'follow_up' | 'reply';
}

export interface InterestThreadCapture {
  readonly use: InterestThreadTurnUse;
  readonly topic: AIProviderDialogueTopic;
  readonly expiresAt: string;
  readonly generation: number;
}

/** Application selection for explicit user chat; never shared with social/event recall. */
export interface IInterestThreadDialogue {
  /** Before an active Turn exists: bounded maintenance and scoped local refusal command. */
  admit(input: {
    readonly text: string; readonly replyTo?: InterestThreadRef; readonly lastOffered?: InterestThreadRef;
    readonly deadlineMs: number;
  }, context: MemoryOperationContext): Promise<MemoryResult<{
    readonly kind: 'continue' | 'closed'; readonly generation: number;
  }>>;
  prepare(input: {
    readonly requestId: string; readonly userMessageId: string; readonly text: string;
    readonly replyTo?: InterestThreadRef; readonly deadlineMs: number;
  }, context: MemoryOperationContext): Promise<MemoryResult<InterestThreadCapture | null>>;
  /** Checks generation and expiry again before dispatch and publication. */
  isCurrent(capture: InterestThreadCapture): boolean;
}

/** Uses the existing worker queue; source checks and state/suppression writes are atomic. */
export interface IInterestThreadRepository {
  /** Pure read. Invalid source/expiry is closed only by a separate mutation barrier. */
  read(context: MemoryOperationContext): Promise<MemoryResult<{
    readonly thread: InterestThread | null; readonly sourceValid: boolean;
  }>>;
  /** Advances the generation barrier even on rollback, like explicit memory-item mutations. */
  mutate(command: InterestThreadMutation, next: MemoryOperationContext): Promise<MemoryResult<InterestThreadReceipt>>;
  /** Commits the sole attempt before dispatch. A used/expired topic returns null; no automatic retry. */
  claim(command: {
    readonly expected: InterestThreadRef; readonly requestId: string; readonly userMessageId: string;
    readonly now: string;
  }, context: MemoryOperationContext): Promise<MemoryResult<InterestThreadCapture | null>>;
  /** Explicit reply binding; it does not mark answered until appendTurn commits. */
  captureReply(command: {
    readonly expected: InterestThreadRef; readonly requestId: string; readonly userMessageId: string; readonly now: string;
  }, context: MemoryOperationContext): Promise<MemoryResult<InterestThreadCapture | null>>;
}
