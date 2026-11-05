import type { MemoryOperationContext, MemoryResult } from './memory-repository.interface';

/** MIND-A02 target boundaries; Domain owns eligibility, scores and state transitions. */
export type OwnGoalKind = 'recover_energy' | 'seek_novelty';
export type OwnPlanStep = 'rest' | 'explore' | 'calm_look_around';

export interface OwnGoal {
  readonly id: string;
  readonly kind: OwnGoalKind;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: 'pending' | 'completed' | 'cancelled' | 'expired' | 'abandoned';
}

export interface OwnPlan {
  readonly goalId: string;
  readonly steps: readonly OwnPlanStep[];
  readonly stepIndex: number;
  readonly attempts: number;
  readonly claim: null | {
    readonly appRunId: string;
    readonly stepToken: string;
    readonly runId: string | null;
  };
}

/** At most two goals, one active plan, and one revisioned worker row. */
export interface MotivationRecord {
  readonly revision: number;
  readonly goals: readonly OwnGoal[];
  readonly plan: OwnPlan | null;
  readonly noveltyArmed: boolean;
  readonly recoveryArmed: boolean;
  readonly lastSeenAt: string;
}

export interface IMotivationRepository {
  read(now: string, context: MemoryOperationContext): Promise<MemoryResult<MotivationRecord | null>>;
  /** Startup ownership recovery; ordinary reads never abandon a live claimed step. */
  restore?(now: string, context: MemoryOperationContext): Promise<MemoryResult<MotivationRecord | null>>;
  /** Claims, finish and replacement use one compare-and-set operation. */
  replace(
    value: MotivationRecord,
    expectedRevision: number | null,
    context: MemoryOperationContext,
  ): Promise<MemoryResult<void>>;
}

/** Local optional consumer of the existing cadence and factual Activity lifecycle. */
export interface IOwnGoalsRuntime {
  restore(): Promise<void>;
  opportunity(): void;
  selectedGoalKind(): OwnGoalKind | null;
  selectedPlanStep?(): OwnPlanStep | null;
  offerPlanStep?(step: OwnPlanStep, start: () => boolean): boolean;
  interruptPlanAdmission?(): void;
  activityStarted(runId: string, activityId: string): void;
  activityOutcome(runId: string, result: 'completed' | 'cancelled' | 'failed'): void;
  cancel(): Promise<void>;
  invalidate(): void;
  dispose(): void;
}

/** Bounded factual transition evidence in the existing Character checkpoint. */
export type OwnHabitTransition = {
  readonly appRunId: string;
  readonly exploreRunId: string;
  readonly nextRunId: string;
  readonly nextKind: 'calm_look_around' | 'other';
  readonly completedAt: string;
}

export type OwnHabitMemory = {
  readonly transitions: readonly OwnHabitTransition[];
  readonly lastLearnedAt: string | null;
}
