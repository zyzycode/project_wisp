import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';
import type { ActivityResult, RunnableActivityPriorityClass } from '../../domain/behavior/activity-runner';
import type { MonotonicMs } from '../../domain/behavior/motion-engine';

/** AUTO-A09 target contracts; connected to the existing Brain executor in #50. */
export interface ProviderBehaviorOffer {
  readonly intent: Readonly<BehaviorIntent> & { readonly source: 'provider'; readonly requestId: string };
  readonly conversationId: string;
  readonly generation: number;
  readonly requestedAtMs: MonotonicMs;
  readonly receivedAtMs: MonotonicMs;
  /** Main-owned deadline, never renewed by receive, defer, or cursor refresh. */
  readonly expiresAtMs: MonotonicMs;
}

export type BehaviorAdmissionRejection =
  | 'invalid_offer' | 'stale_generation' | 'duplicate' | 'expired'
  | 'user_conflict' | 'forced_motion' | 'character_gate' | 'quiet'
  | 'cooldown' | 'budget' | 'unreachable_target' | 'no_activity'
  | 'active_provider' | 'disabled' | 'no_behavior_command';

export type BehaviorAdmissionReceipt =
  | { readonly status: 'rejected'; readonly reason: BehaviorAdmissionRejection }
  | { readonly status: 'admitted'; readonly admissionId: string; readonly mode: 'immediate' }
  | {
      readonly status: 'admitted';
      readonly admissionId: string;
      readonly mode: 'safe_deferred';
      readonly startBeforeMs: MonotonicMs;
    };

/** Orthogonal to ActivityDefinition priority; provider priority is assigned locally. */
export type ActivityOwnership =
  | { readonly source: 'local' | 'user' | 'character'; readonly rank: RunnableActivityPriorityClass }
  | {
      readonly source: 'provider';
      readonly rank: 'P3_reactive';
      readonly admissionId: string;
      readonly requestId: string;
      readonly conversationId: string;
      readonly generation: number;
      readonly expiresAtMs: MonotonicMs;
    };

export interface OwnedActivityRun {
  readonly runId: string;
  readonly ownership: ActivityOwnership;
  readonly startedAtMs: MonotonicMs;
  readonly executionEndsAtMs: MonotonicMs;
}

export type BehaviorExecutionEvent =
  | { readonly type: 'started'; readonly admissionId: string; readonly run: OwnedActivityRun }
  | {
      readonly type: 'not_started';
      readonly admissionId: string;
      readonly atMs: MonotonicMs;
      readonly reason: BehaviorAdmissionRejection | 'defer_timeout' | 'reset' | 'disposed';
    }
  | {
      readonly type: 'terminated';
      readonly admissionId: string;
      readonly runId: string;
      readonly result: ActivityResult;
    };

/** Application boundary; implementation delegates semantic decisions to Character. */
export interface IBehaviorAdmission {
  offer(offer: ProviderBehaviorOffer): BehaviorAdmissionReceipt;
}

export interface BehaviorAdmissionTuning {
  readonly version: string;
  readonly offerTtlMs: number;
  readonly maxSafeDeferMs: number;
  readonly maxProviderRunMs: number;
}

/** One shared runtime budget for unsolicited cursor gestures/approach and SocialBid. */
export interface InitiativeBudgetSnapshot {
  readonly windowStartedAtMs: MonotonicMs;
  readonly startedEpisodes: number;
  readonly nextEligibleAtMs: MonotonicMs;
}

export interface InitiativeTuning {
  readonly version: string;
  readonly windowMs: number;
  readonly maxEpisodesPerWindow: number;
  readonly minIntervalMs: number;
  readonly cursorEpisodeMaxMs: number;
  readonly cursorApproachMaxDistanceDip: number;
  readonly socialWaitMaxMs: number;
}
