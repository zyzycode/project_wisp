import type {
  LandingOutcome,
  MonotonicMs,
  MotionConstraints,
} from '../../domain/behavior/motion-engine';
import type { CharacterStimulus } from '../../domain/character/stimuli-reducer';

export type ShimejiFeedbackEvent =
  | {
      readonly type: 'drag_started';
      readonly eventId: string;
      readonly atMs: MonotonicMs;
    }
  | {
      readonly type: 'drag_hold';
      readonly eventId: string;
      readonly dragRunId: string;
      readonly heldMs: number;
      readonly atMs: MonotonicMs;
    }
  | {
      readonly type: 'drag_ended';
      readonly eventId: string;
      readonly dragRunId: string;
      readonly heldMs: number;
      readonly atMs: MonotonicMs;
    }
  | {
      readonly type: 'landing';
      readonly eventId: string;
      readonly outcome: LandingOutcome;
      readonly impactSeverity: number;
      readonly atMs: MonotonicMs;
    }
  | {
      readonly type: 'petting';
      readonly eventId: string;
      readonly intensity: number;
      readonly atMs: MonotonicMs;
    }
  | {
      readonly type: 'swat_cursor_completed';
      readonly eventId: string;
      readonly activityRunId: string;
      readonly atMs: MonotonicMs;
    };

export type StimulusDto = CharacterStimulus & { readonly id: string };

export interface ShimejiStimulusMappingContext {
  readonly createdAtIso: string;
  readonly landingThresholds: Pick<MotionConstraints, 'stumbleMaxSeverity'>;
}

export interface IShimejiStimulusMapper {
  map(
    event: ShimejiFeedbackEvent,
    context: ShimejiStimulusMappingContext
  ): StimulusDto | null;
}

/** AUTO-A09 target outcome boundary (#46); legacy Swat migrates to the same run key. */
export interface ActivityOutcomeFeedback {
  readonly type: 'activity_outcome';
  readonly eventId: string;
  readonly activityRunId: string;
  readonly atMs: MonotonicMs;
  readonly family: 'explore' | 'play' | 'calm' | 'rest' | 'cursor_interest' | 'social_bid';
  readonly outcome: 'completed' | 'cancelled' | 'failed';
  readonly participation: 'solitary' | 'user_engaged';
  /** Actual Brain execution, excluding deferred admission and provider waiting. */
  readonly executedMs: number;
  /** Completed semantic play phase, independent of Skin playback. */
  readonly playCompleted: boolean;
}

/** Supersedes the mapper input at #46 cutover; not a second feedback consumer. */
export interface IActivityOutcomeStimulusMapper {
  map(
    event: ShimejiFeedbackEvent | ActivityOutcomeFeedback,
    context: ShimejiStimulusMappingContext
  ): StimulusDto | null;
}
