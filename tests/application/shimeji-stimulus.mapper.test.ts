import { describe, expect, it } from 'vitest';
import { ShimejiStimulusMapper } from '../../src/application/services/shimeji-stimulus.mapper';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { shyDreamGirlPreset, type CharacterState } from '../../src/domain/character';

const context = {
  createdAtIso: '2026-09-05T12:00:00.000Z',
  landingThresholds: { stumbleMaxSeverity: 950 },
};

function characterState(): CharacterState {
  return {
    needs: { energy: 70, attention: 50, play: 50, comfort: 50, boredom: 50 },
    relationship: { friendship: 0, love: 0, loveUnlocked: false },
    personality: shyDreamGirlPreset,
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: false,
      boundariesKnown: false,
    },
    preferences: {},
    lastUpdated: Date.parse('2026-09-05T11:00:00.000Z'),
  };
}

describe('Application: Shimeji stimulus mapper', () => {
  it('maps drag lifecycle into stable user stimulus identities', () => {
    const mapper = new ShimejiStimulusMapper();

    expect(mapper.map({
      type: 'drag_started', eventId: 'drag-1:started', atMs: 10,
    }, context)).toEqual({
      id: 'drag-1:started', type: 'user_drag_start', source: 'user',
      createdAt: context.createdAtIso, metadata: { deltaMs: 0 },
    });
    expect(mapper.map({
      type: 'drag_hold', eventId: 'drag-1:hold', dragRunId: 'drag-1', heldMs: 500, atMs: 500,
    }, context)).toEqual({
      id: 'drag-1:hold', type: 'system_event', source: 'user',
      createdAt: context.createdAtIso,
      metadata: { deltaMs: 0, dragRunId: 'drag-1', heldMs: 500 },
    });
    expect(mapper.map({
      type: 'drag_ended', eventId: 'drag-1:ended', dragRunId: 'drag-1', heldMs: 500, atMs: 510,
    }, context)).toEqual({
      id: 'drag-1:ended', type: 'user_drag_end', source: 'user',
      createdAt: context.createdAtIso,
      metadata: { deltaMs: 0, dragRunId: 'drag-1', heldMs: 500 },
    });
  });

  it('ignores soft landing and maps crash landing to one system stimulus', () => {
    const mapper = new ShimejiStimulusMapper();
    expect(mapper.map({
      type: 'landing', eventId: 'landing-soft', outcome: 'soft_landing',
      impactSeverity: 200, atMs: 20,
    }, context)).toBeNull();

    const stimulus = mapper.map({
      type: 'landing', eventId: 'landing-crash', outcome: 'crash_landing',
      impactSeverity: 1_200, atMs: 30,
    }, context);
    expect(stimulus).toEqual({
      id: 'landing-crash', type: 'system_event', source: 'system',
      createdAt: context.createdAtIso,
      metadata: {
        deltaMs: 0,
        landingOutcome: 'crash_landing',
        impactSeverity: 1_200,
        stumbleMaxSeverity: 950,
      },
    });

    const service = new CharacterStateService({ initialState: characterState() });
    const before = service.getState();
    service.applyStimulus(stimulus!);
    expect(service.getState()).not.toBe(before);
    expect(service.getState().lastUpdated).toBe(Date.parse(context.createdAtIso));
  });
});
