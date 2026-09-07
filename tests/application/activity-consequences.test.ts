import { describe, expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CharacterInteractionUseCase } from '../../src/application/services/character-interaction.use-case';
import { ShimejiStimulusMapper } from '../../src/application/services/shimeji-stimulus.mapper';

describe('AUTO-I11 action consequences', () => {
  it('does not reward a play request before admission', () => {
    const service = new CharacterStateService({ now: () => 0 });
    const before = service.getState();
    new CharacterInteractionUseCase(service).execute({ type: 'play' });
    expect(service.getState()).toEqual(before);
  });

  it.each([
    [{ activityOutcome: 'explore_completed' }, -1, 0, -8],
    [{ dragRunId: 'drag', heldMs: 2000 }, 0, 2, 0],
    [{ landingOutcome: 'stumble' }, -1, 2, 0],
    [{ landingOutcome: 'crash_landing' }, -2, 6, 0],
  ] as const)('applies physical and exploration semantics %j', (metadata, energy, comfort, boredom) => {
    const service = new CharacterStateService({ now: () => 0 });
    const before = service.getState();
    const after = service.applyStimulus({ type: 'system_event', metadata: { ...metadata, deltaMs: 0 } });
    expect(after.needs.energy).toBe(before.needs.energy + energy);
    expect(after.needs.comfort).toBe(before.needs.comfort + comfort);
    expect(after.needs.boredom).toBe(before.needs.boredom! + boredom);
    expect(after.relationship).toEqual(before.relationship);
  });

  it('does not turn solitary completed play into social contact', () => {
    const service = new CharacterStateService({ now: () => 0 });
    const before = service.getState();
    const after = service.applyStimulus({ type: 'play', metadata: { deltaMs: 0, participation: 'solitary' } });
    expect(after.needs.attention).toBe(before.needs.attention);
    expect(after.relationship).toEqual(before.relationship);
    expect(after.needs.play).toBe(before.needs.play - 15);
  });

  it('keeps soft landing free of penalties', () => {
    expect(new ShimejiStimulusMapper().map({ type: 'landing', eventId: 'land', atMs: 0,
      outcome: 'soft_landing', impactSeverity: 0 }, { createdAtIso: new Date(0).toISOString(),
      landingThresholds: { stumbleMaxSeverity: 10 } })).toBeNull();
  });
});
