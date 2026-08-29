import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INTIMACY_THRESHOLDS,
  adaptPersonalityAxes,
  calculateShyness,
  canExpressFlirt,
  createCharacterSnapshot,
  metabolizeNeeds,
  processStimulus,
  shyDreamGirlPreset,
  synthesizeEmotionalTone,
  trackPreference,
} from '../../src/domain/character';
import type { CharacterState } from '../../src/domain/character';

function createState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    needs: {
      energy: 70,
      attention: 20,
      play: 20,
      comfort: 20,
      boredom: 15,
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
    expect(canExpressFlirt(createState({ needs: { energy: 29, attention: 20, play: 20, comfort: 20, boredom: 15 } }))).toBe(false);
    expect(canExpressFlirt(createState({ needs: { energy: 70, attention: 20, play: 20, comfort: 61, boredom: 15 } }))).toBe(false);
  });

  it('synthesizes emotional tone by contract priority', () => {
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 20, attention: 20, play: 100, comfort: 20, boredom: 15 } }))).toBe(
      'sleepy'
    );
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 70, attention: 20, play: 20, comfort: 80, boredom: 15 } }))).toBe(
      'sleepy'
    );
    expect(synthesizeEmotionalTone(createState({ relationship: { friendship: 399, love: 0, loveUnlocked: false } }))).toBe(
      'shy'
    );
    expect(synthesizeEmotionalTone(createState({ relationship: { friendship: 500, love: 500, loveUnlocked: true } }))).toBe(
      'affectionate'
    );
    expect(synthesizeEmotionalTone(createState({ needs: { energy: 70, attention: 20, play: 70, comfort: 20, boredom: 15 } }))).toBe(
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

  it('metabolizes needs with soft long-absence drift and no relationship penalty', () => {
    const needs = {
      energy: 10,
      attention: 0,
      play: 0,
      comfort: 95,
      boredom: 0,
    };

    const nextNeeds = metabolizeNeeds(needs, 30 * 24 * 60 * 60 * 1000, 'neutral');

    expect(nextNeeds.energy).toBeGreaterThan(70);
    expect(nextNeeds.attention).toBeLessThanOrEqual(56);
    expect(nextNeeds.play).toBeLessThanOrEqual(60);
    expect(nextNeeds.comfort).toBeLessThan(20);
    expect(nextNeeds.boredom).toBeGreaterThan(50);
    expect(needs).toEqual({
      energy: 10,
      attention: 0,
      play: 0,
      comfort: 95,
      boredom: 0,
    });
  });

  it('adapts personality axes with plasticity, soft resistance, and hard bounds', () => {
    const axes = {
      ...shyDreamGirlPreset.axes,
      boldness: {
        base: 0.5,
        current: 0.5,
        softMin: 0.4,
        softMax: 0.6,
        hardMin: 0.2,
        hardMax: 0.65,
        plasticity: 1,
      },
    };

    const resisted = adaptPersonalityAxes(axes, { boldness: 0.2 });
    const hardClamped = adaptPersonalityAxes(axes, { boldness: 10 });

    expect(resisted.boldness.current).toBeCloseTo(0.635, 3);
    expect(hardClamped.boldness.current).toBe(0.65);
    expect(axes.boldness.current).toBe(0.5);
  });

  it('tracks preference samples, confidence, and value drift', () => {
    const first = trackPreference({}, 'tea', 60);
    const second = trackPreference(first, 'tea', -60);

    expect(first.tea).toEqual({
      value: 60,
      confidence: 1 / 7,
      samples: 1,
    });
    expect(second.tea).toEqual({
      value: 0,
      confidence: 0.25,
      samples: 2,
    });
  });

  it('processes stimuli immutably and unlocks love through friendship progression', () => {
    const state = createState({
      relationship: { friendship: 395, love: 0, loveUnlocked: false },
      lastUpdated: 1000,
    });

    const next = processStimulus(state, {
      type: 'topic_dialogue',
      intensity: 2,
      metadata: {
        topicKey: 'games',
        preferenceValue: 80,
      },
    });

    expect(next).not.toBe(state);
    expect(next.needs).not.toBe(state.needs);
    expect(next.personality).not.toBe(state.personality);
    expect(next.relationship.friendship).toBe(411);
    expect(next.relationship.loveUnlocked).toBe(true);
    expect(next.relationship.love).toBe(4);
    expect(next.preferences.games).toEqual({
      value: 80,
      confidence: 1 / 7,
      samples: 1,
    });
    expect(state.relationship).toEqual({ friendship: 395, love: 0, loveUnlocked: false });
    expect(state.preferences).toEqual({});
  });

  it('processes click, pet, and chat message stimuli as bounded positive interactions', () => {
    const state = createState({
      needs: { energy: 70, attention: 50, play: 50, comfort: 50, boredom: 50 },
      relationship: { friendship: 410, love: 10, loveUnlocked: true },
    });

    const clicked = processStimulus(state, { type: 'click' });
    const petted = processStimulus(clicked, { type: 'pet' });
    const chatted = processStimulus(petted, { type: 'chat_message' });

    expect(clicked.relationship.friendship).toBe(411);
    expect(clicked.relationship.love).toBe(10);
    expect(clicked.needs.boredom ?? 0).toBeLessThan(state.needs.boredom ?? 0);

    expect(petted.relationship.friendship).toBe(415);
    expect(petted.relationship.love).toBe(12);
    expect(petted.needs.boredom ?? 0).toBeLessThan(clicked.needs.boredom ?? 0);

    expect(chatted.relationship.friendship).toBe(421);
    expect(chatted.relationship.love).toBe(13);
    expect(chatted.needs.attention).toBeLessThan(state.needs.attention);
    expect(chatted.needs.play).toBeLessThan(state.needs.play);
    expect(chatted.needs.comfort).toBeLessThan(state.needs.comfort);
    expect(chatted.needs.boredom ?? 0).toBeLessThan(petted.needs.boredom ?? 0);
  });

  it('catches up need metabolism before applying a non-idle stimulus', () => {
    const state = createState({
      needs: { energy: 40, attention: 0, play: 0, comfort: 20, boredom: 0 },
      relationship: { friendship: 100, love: 0, loveUnlocked: false },
      lastUpdated: 1000,
    });

    const next = processStimulus(state, {
      type: 'chat_message',
      metadata: {
        deltaMs: 14 * 24 * 60 * 60 * 1000,
      },
    });

    expect(next.lastUpdated).toBe(14 * 24 * 60 * 60 * 1000 + 1000);
    expect(next.needs.attention).toBeGreaterThan(0);
    expect(next.needs.attention).toBeLessThan(56);
    expect(next.needs.play).toBeGreaterThan(0);
    expect(next.relationship.friendship).toBe(106);
    expect(state.needs).toEqual({ energy: 40, attention: 0, play: 0, comfort: 20, boredom: 0 });
  });

  it('does not degrade relationship during idle ticks', () => {
    const state = createState({
      needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 10 },
      relationship: { friendship: 300, love: 25, loveUnlocked: false },
      lastUpdated: 0,
    });

    const next = processStimulus(state, {
      type: 'idle_tick',
      metadata: {
        deltaMs: 14 * 24 * 60 * 60 * 1000,
      },
    });

    expect(next.relationship).toEqual(state.relationship);
    expect(next.needs.attention).toBeGreaterThan(state.needs.attention);
    expect(next.needs.attention).toBeLessThan(56);
    expect(next.needs.boredom ?? 0).toBeGreaterThan(state.needs.boredom ?? 0);
  });
});
