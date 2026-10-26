import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INTIMACY_THRESHOLDS,
  adaptPersonalityAxes,
  calculateShyness,
  canExpressFlirt,
  createCharacterSnapshot,
  metabolizeNeeds,
  processStimulus,
  curiousStubbornGirlPreset,
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
      boredom: 15,
      ...overrides.needs,
    },
    relationship: {
      friendship: 450,
      love: 0,
      loveUnlocked: true,
      ...overrides.relationship,
    },
    personality: overrides.personality ?? curiousStubbornGirlPreset,
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
  it('defines the Curious Stubborn Girl preset with contract calibration', () => {
    expect(curiousStubbornGirlPreset.id).toBe('curiousStubbornGirl');
    expect(curiousStubbornGirlPreset.displayName).toBe('Curious Stubborn Girl');
    expect(curiousStubbornGirlPreset.axes).toEqual({
      openness: { base: 0.68, current: 0.68, softMin: 0.45, softMax: 0.85, hardMin: 0.25, hardMax: 0.95, plasticity: 0.3 },
      extraversion: { base: 0.6, current: 0.6, softMin: 0.45, softMax: 0.78, hardMin: 0.2, hardMax: 0.9, plasticity: 0.25 },
      agreeableness: { base: 0.62, current: 0.62, softMin: 0.5, softMax: 0.85, hardMin: 0.35, hardMax: 0.98, plasticity: 0.2 },
      sensitivity: { base: 0.58, current: 0.58, softMin: 0.4, softMax: 0.72, hardMin: 0.25, hardMax: 0.9, plasticity: 0.18 },
      playfulness: { base: 0.62, current: 0.62, softMin: 0.4, softMax: 0.8, hardMin: 0.2, hardMax: 0.95, plasticity: 0.35 },
      boldness: { base: 0.55, current: 0.55, softMin: 0.4, softMax: 0.75, hardMin: 0.2, hardMax: 0.9, plasticity: 0.22 },
      independence: { base: 0.68, current: 0.68, softMin: 0.45, softMax: 0.88, hardMin: 0.25, hardMax: 0.98, plasticity: 0.25 },
    });
  });

  it('calculates shyness from sensitivity, boldness, and extraversion', () => {
    expect(calculateShyness(curiousStubbornGirlPreset.axes)).toBeCloseTo(0.4985, 4);
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
      'neutral'
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
        presetId: 'curiousStubbornGirl',
        aiSelfConcept: curiousStubbornGirlPreset.aiSelfConcept,
        traits: {
          shyness: calculateShyness(curiousStubbornGirlPreset.axes),
          playfulness: 0.62,
          sensitivity: 0.58,
          boldness: 0.55,
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
      ...curiousStubbornGirlPreset.axes,
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

  it('processes stimuli immutably, gates love with consent, and rejects unverified preference metadata', () => {
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
    expect(next.preferences).toEqual({});
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

    expect(clicked.relationship.friendship).toBe(410);
    expect(clicked.relationship.love).toBe(10);
    expect(clicked.needs.boredom).toBe(state.needs.boredom);
    expect(clicked.needs.attention).toBe(48);

    expect(petted.relationship.friendship).toBe(414);
    expect(petted.relationship.love).toBe(12);
    expect(petted.needs.boredom ?? 0).toBeLessThan(clicked.needs.boredom ?? 0);

    expect(chatted.relationship.friendship).toBe(414);
    expect(chatted.relationship.love).toBe(12);
    expect(chatted.needs.attention).toBeLessThan(state.needs.attention);
    expect(chatted.needs.play).toBe(state.needs.play);
    expect(chatted.needs.comfort).toBeLessThan(state.needs.comfort);
    expect(chatted.needs.boredom).toBe(petted.needs.boredom);
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
    expect(next.relationship.friendship).toBe(100);
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

it('keeps authored identity bounded and shy tone situational beyond the soft envelope', () => {
  expect(curiousStubbornGirlPreset.aiSelfConcept.length).toBeLessThanOrEqual(500);
  const state = createState({ relationship: { friendship: 0, love: 0, loveUnlocked: false } });
  state.personality = { ...state.personality, axes: Object.fromEntries(Object.entries(state.personality.axes).map(([key, axis]) => [key, { ...axis, current: key === 'sensitivity' ? axis.softMax : key === 'boldness' || key === 'extraversion' ? axis.softMin : axis.base }])) as typeof state.personality.axes };
  expect(calculateShyness(state.personality.axes)).toBeLessThanOrEqual(0.644);
  expect(synthesizeEmotionalTone(state)).toBe('neutral');
  state.personality.axes.sensitivity.current = state.personality.axes.sensitivity.hardMax;
  state.personality.axes.boldness.current = state.personality.axes.boldness.hardMin;
  state.personality.axes.extraversion.current = state.personality.axes.extraversion.hardMin;
  expect(synthesizeEmotionalTone(state)).toBe('shy');
});
