import type {
  IActivityOutcomeStimulusMapper,
  ActivityOutcomeFeedback,
  ShimejiFeedbackEvent,
  ShimejiStimulusMappingContext,
  StimulusDto,
} from '../ports/shimeji-feedback-port';

/** Pure mapping from one semantic Shimeji outcome to one Character stimulus. */
export class ShimejiStimulusMapper implements IActivityOutcomeStimulusMapper {
  public map(
    event: ShimejiFeedbackEvent | ActivityOutcomeFeedback,
    context: ShimejiStimulusMappingContext
  ): StimulusDto | null {
    const metadata = { deltaMs: 0 };
    if (event.type === 'activity_outcome') {
      if (!event.activityRunId.trim() || !Number.isFinite(event.executedMs) || event.executedMs < 0) return null;
      const explore = event.family === 'explore' && event.outcome === 'completed';
      const play = (event.family === 'play' || event.family === 'cursor_interest') && event.playCompleted;
      if (!explore && !play) return null;
      return { id: event.eventId, type: explore ? 'system_event' : 'play', source: 'system',
        createdAt: context.createdAtIso, intensity: 1, metadata: { ...metadata,
          activityRunId: event.activityRunId, participation: event.participation,
          ...(explore ? { activityOutcome: 'explore_completed' } : {}) } };
    }
    if (event.type === 'drag_started') {
      return {
        id: event.eventId,
        type: 'user_drag_start',
        source: 'user',
        createdAt: context.createdAtIso,
        metadata,
      };
    }
    if (event.type === 'drag_hold') {
      return {
        id: event.eventId,
        type: 'system_event',
        source: 'user',
        createdAt: context.createdAtIso,
        metadata: { ...metadata, dragRunId: event.dragRunId, heldMs: event.heldMs },
      };
    }
    if (event.type === 'drag_ended') {
      return {
        id: event.eventId,
        type: 'user_drag_end',
        source: 'user',
        createdAt: context.createdAtIso,
        metadata: { ...metadata, dragRunId: event.dragRunId, heldMs: event.heldMs },
      };
    }
    if (event.type === 'landing') {
      if (event.outcome === 'soft_landing') return null;
      return {
        id: event.eventId,
        type: 'system_event',
        source: 'system',
        createdAt: context.createdAtIso,
        metadata: {
          ...metadata,
          landingOutcome: event.outcome,
          impactSeverity: event.impactSeverity,
          stumbleMaxSeverity: context.landingThresholds.stumbleMaxSeverity,
        },
      };
    }
    if (event.type === 'petting') {
      return {
        id: event.eventId,
        type: 'user_pet',
        source: 'user',
        createdAt: context.createdAtIso,
        intensity: event.intensity,
        metadata,
      };
    }
    return {
      id: event.eventId,
      type: 'play',
      source: 'system',
      createdAt: context.createdAtIso,
      metadata: { ...metadata, activityRunId: event.activityRunId },
    };
  }
}
