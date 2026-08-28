import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INTIMACY_THRESHOLDS,
  calculateShyness,
  canExpressFlirt,
  createCharacterSnapshot,
  shyDreamGirlPreset,
  synthesizeEmotionalTone,
} from '../../src/domain/character';
import type { CharacterState } from '../../src/domain/character';

function createState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    needs: {
      energy: 70,
      attention: 20,
      play: 20,
      comfort: 20,
      ...overrides.needs,
    },
    relationship: {
      friendship: 450,
      love: 0,
      loveUnlocked: true,
      ...overrides.relationship,
    },
    personality: overrides.personality ?? shyDreamGirlPreset,
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: true,
      boundariesKnown: true,
      ...overrides.intimacy,
    },
    preferences: overrides.preferences ?? {},
    lastUpdated: overrides.lastUpdated ?? 0,
  };
}

describe('Domain: Character Engine v2', () => {
  it('defines the Shy Dream Girl preset with contract calibration', () => {
    expect(shyDreamGirlPreset.id).toBe('shyDreamGirl');
    expect(shyDreamGirlPreset.displayName).toBe('Shy Dream Girl');
    expect(shyDreamGirlPreset.axes).toEqual({
      openness: {
        base: 0.55,
        current: 0.55,
        softMin: 0.35,
        softMax: 0.75,
        hardMin: 0.2,
        hardMax: 0.9,
        plasticity: 0.3,
      },
      extraversion: {
        base: 0.28,
        current: 0.28,
        softMin: 0.15,
        softMax: 0.5,
        hardMin: 0.05,
        hardMax: 0.7,
        plasticity: 0.25,
      },
      agreeableness: {
        base: 0.86,
        current: 0.86,
        softMin: 0.65,
        softMax: 0.96,
        hardMin: 0.45,
        hardMax: 1.0,
        plasticity: 0.2,
      },
      sensitivity: {
        base: 0.88,
        current: 0.88,
        softMin: 0.68,
        softMax: 0.98,
        hardMin: 0.5,
        hardMax: 1.0,
        plasticity: 0.18,
      },
      playfulness: {
        base: 0.42,
        current: 0.42,
        softMin: 0.25,
        softMax: 0.7,
        hardMin: 0.1,
        hardMax: 0.85,
        plasticity: 0.35,
      },
      boldness: {
        base: 0.18,
        current: 0.18,
        softMin: 0.08,
        softMax: 0.38,
        hardMin: 0.02,
        hardMax: 0.58,
        plasticity: 0.22,
      },
      independence: {
        base: 0.58,
        current: 0.58,
        softMin: 0.35,
        softMax: 0.82,
        hardMin: 0.2,
        hardMax: 0.95,
        plasticity: 0.25,
      },
    });
  });

  it('calculates shyness from sensitivity, boldness, and extraversion', () => {
    expect(calculateShyness(shyDreamGirlPreset.axes)).toBeCloseTo(0.827, 3);
  });

  it('gates flirt expression with consent, love unlock, friendship, energy, and comfort', () => {
    expect(DEFAULT_INTIMACY_THRESHOLDS).toEqual({
      FRIENDSHIP_FLIRT_THRESHOLD: 500,
      MIN_FLIRT_ENERGY: 30,
      MAX_COMFORT_NEED: 60,
      LOVE_UNLOCK_FRIENDSHIP_THRESHOLD: 400,
    });

    expect(canExpressFlirt(createState({ relationship: { friendship: 500, love: 0, loveUnlocked: true } }))).toBe(
      true
    );
    expect(canExpressFlirt(createState({ intimacy: { flirtiness: 0, romanticCharge: 0, userConsentEnabled: false, boundariesKnown: true } }))).toBe(
      false
    );
    expect(canExpressFlirt(createState({ relationship: { friendship: 500, love: 0, loveUnlocked: false } }))).toBe(
      false
    );
    expect(canExpressFlirt(createState({ relationship: { friendship: 499, love: 0, loveUnlocked: true } }))).toBe(
      false
    );
    expect(canExpressFlirt(createState({ needs: { energy: 29, attention: 20, play: 20, comfort: 20 } }))).toBe(false);
    expect(canExpressFlirt(createState({ needs: { energy: 70, attention: 20, play: 20, comfort: 61 } }))).toBe(false);
  });

  it('synthesizes emotional tone by contract priority', () => {
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 20, attention: 20, play: 100, comfort: 20 } }))).toBe(
      'sleepy'
    );
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 70, attention: 20, play: 20, comfort: 80 } }))).toBe(
      'sleepy'
    );
    expect(synthesizeEmotionalTone(createState({ relationship: { friendship: 399, love: 0, loveUnlocked: false } }))).toBe(
      'shy'
    );
    expect(synthesizeEmotionalTone(createState({ relationship: { friendship: 500, love: 500, loveUnlocked: true } }))).toBe(
      'affectionate'
    );
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 70, attention: 20, play: 70, comfort: 20 } }))).toBe(
      'playful'
    );
    expect(synthesizeEmotionalTone(createState())).toBe('neutral');
  });

  it('creates provider-ready character snapshots from current state', () => {
    const state = createState({
      relationship: { friendship: 500, love: 500, loveUnlocked: true },
      intimacy: { flirtiness: 12, romanticCharge: 34, userConsentEnabled: true, boundariesKnown: true },
      preferences: {
        tea: { value: 80, confidence: 0.4, samples: 3 },
      },
      lastUpdated: 123,
    });

    expect(createCharacterSnapshot(state)).toEqual({
      needs: state.needs,
      relationship: state.relationship,
      personality: {
        presetId: 'shyDreamGirl',
        aiSelfConcept: shyDreamGirlPreset.aiSelfConcept,
        traits: {
          shyness: calculateShyness(shyDreamGirlPreset.axes),
          playfulness: 0.42,
          sensitivity: 0.88,
          boldness: 0.18,
        },
      },
      intimacy: {
        flirtiness: 12,
        romanticCharge: 34,
        userConsentEnabled: true,
      },
      synthesizedTone: 'affectionate',
    });
  });
});
