import { describe, it, expect } from 'vitest';
import { calculateShyness, shyDreamGirlPreset } from '../../../src/domain/character';
import type { CharacterState } from '../../../src/domain/character';
import { CharacterStateService } from '../../../src/application/services/character-state.service';

function createState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    needs: {
      energy: 70,
      attention: 50,
      play: 50,
      comfort: 50,
      ...overrides.needs,
    },
    relationship: {
      friendship: 395,
      love: 0,
      loveUnlocked: false,
      ...overrides.relationship,
    },
    personality: overrides.personality ?? shyDreamGirlPreset,
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: false,
      boundariesKnown: false,
      ...overrides.intimacy,
    },
    preferences: overrides.preferences ?? {},
    lastUpdated: overrides.lastUpdated ?? 1000,
  };
}

describe('Application: CharacterStateService', () => {
  it('initializes in-memory state with the Shy Dream Girl preset', () => {
    const service = new CharacterStateService({ now: () => 1234 });

    const state = service.getState();
    const snapshot = service.getSnapshot();

    expect(state.lastUpdated).toBe(1234);
    expect(state.personality.id).toBe('shyDreamGirl');
    expect(state.personality).toEqual(shyDreamGirlPreset);
    expect(snapshot.personality.presetId).toBe('shyDreamGirl');
    expect(snapshot.personality.aiSelfConcept).toBe(shyDreamGirlPreset.aiSelfConcept);
    expect(snapshot.personality.traits.shyness).toBeCloseTo(
      calculateShyness(shyDreamGirlPreset.axes),
      3
    );
    expect(snapshot.synthesizedTone).toBe('shy');
  });

  it('applies stimuli through the domain character reducer', () => {
    const service = new CharacterStateService({
      initialState: createState({
        needs: { energy: 70, attention: 50, play: 50, comfort: 50 },
      }),
    });

    const before = service.getState();
    const after = service.applyStimulus({
      type: 'user_message',
      source: 'user',
      text: 'Привет, Wisp',
      createdAt: new Date(before.lastUpdated).toISOString(),
    });

    expect(after).not.toBe(before);
    expect(after.relationship.friendship).toBe(401);
    expect(after.relationship.loveUnlocked).toBe(true);
    expect(after.relationship.love).toBe(1);
    expect(after.needs.attention).toBeLessThan(before.needs.attention);
    expect(after.needs.play).toBeLessThan(before.needs.play);
  });

  it('ticks need metabolism in memory without relationship decay', () => {
    const service = new CharacterStateService({
      initialState: createState({
        needs: { energy: 40, attention: 0, play: 0, comfort: 20 },
        relationship: { friendship: 300, love: 25, loveUnlocked: false },
        lastUpdated: 1000,
      }),
    });

    const after = service.tickNeeds(14 * 24 * 60 * 60 * 1000, 'neutral');

    expect(after.lastUpdated).toBe(14 * 24 * 60 * 60 * 1000 + 1000);
    expect(after.needs.attention).toBeGreaterThan(0);
    expect(after.needs.play).toBeGreaterThan(0);
    expect(after.relationship).toEqual({
      friendship: 300,
      love: 25,
      loveUnlocked: false,
    });
  });

  it('returns defensive copies of stored state', () => {
    const service = new CharacterStateService({ now: () => 1000 });
    const state = service.getState();

    state.needs.energy = 0;
    state.personality.axes.boldness.current = 1;

    expect(service.getState().needs.energy).toBe(85);
    expect(service.getState().personality.axes.boldness.current).toBe(0.18);
  });
});
