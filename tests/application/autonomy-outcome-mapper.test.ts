import { describe, expect, it } from 'vitest';
import { ShimejiStimulusMapper } from '../../src/application/services/shimeji-stimulus.mapper';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';
const context = { createdAtIso: new Date(0).toISOString(), landingThresholds: { stumbleMaxSeverity: 10 } };
const event: ActivityOutcomeFeedback = { type: 'activity_outcome', eventId: 'end', activityRunId: 'run',
  atMs: 2000, executedMs: 2000, family: 'play', participation: 'solitary', outcome: 'cancelled', playCompleted: false };
describe('confirmed execution feedback', () => {
  it('rewards a completed phase even if its subsequent settle is cancelled', () => {
    const mapper = new ShimejiStimulusMapper();
    expect(mapper.map(event, context)).toBeNull();
    expect(mapper.map({ ...event, playCompleted: true }, context)?.type).toBe('play');
  });
  it('requires the entire Explore chain to complete', () => {
    const mapper = new ShimejiStimulusMapper();
    expect(mapper.map({ ...event, family: 'explore' }, context)).toBeNull();
    expect(mapper.map({ ...event, family: 'explore', outcome: 'completed' }, context)?.metadata?.activityOutcome).toBe('explore_completed');
  });
});
