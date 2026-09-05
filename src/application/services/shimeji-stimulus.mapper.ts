import type {
  IShimejiStimulusMapper,
  ShimejiFeedbackEvent,
  ShimejiStimulusMappingContext,
  StimulusDto,
} from '../ports/shimeji-feedback-port';

/** Pure mapping from one semantic Shimeji outcome to one Character stimulus. */
export class ShimejiStimulusMapper implements IShimejiStimulusMapper {
  public map(
    event: ShimejiFeedbackEvent,
    context: ShimejiStimulusMappingContext
  ): StimulusDto | null {
    const metadata = { deltaMs: 0 };
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
