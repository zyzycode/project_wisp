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
