import { expect, it } from 'vitest';
import { processStimulus } from '../../src/domain/character/stimuli-reducer';
import { CharacterStateService } from '../../src/application/services/character-state.service';

it('requires current consent for a new love unlock even after friendship crosses 400', () => {
  const state = new CharacterStateService({ now: () => 0 }).getState(); state.relationship.friendship = 399;
  const next = processStimulus(state, { type: 'user_message', source: 'user' });
  expect(next.relationship.friendship).toBe(405); expect(next.relationship.loveUnlocked).toBe(false); expect(next.relationship.love).toBe(0);
});
it('preserves historical love/latch but forbids positive growth after consent is withdrawn', () => {
  const state = new CharacterStateService({ now: () => 0 }).getState(); state.relationship = { friendship: 600, love: 200, loveUnlocked: true }; state.intimacy.userConsentEnabled = false;
  const next = processStimulus(state, { type: 'pet', source: 'user' });
  expect(next.relationship.loveUnlocked).toBe(true); expect(next.relationship.love).toBe(200); expect(next.intimacy.userConsentEnabled).toBe(false);
});

import { createAdaptationGate, takeAdaptationOpportunity } from '../../src/domain/character/adaptation-gate';
import { processStimulusWithAdaptation } from '../../src/domain/character/stimuli-reducer';
import { adaptBoundedExperienceAxes } from '../../src/domain/character/personality-plasticity';
import { learnVerifiedCursorPreference } from '../../src/domain/character/preferences';

it('allows a consented transition without erasing the existing friendship/love rewards', () => {
  const state = new CharacterStateService().getState(); state.relationship.friendship = 399; state.intimacy.userConsentEnabled = true;
  const next = processStimulus(state, { type: 'user_message', source: 'user' }); expect(next.relationship).toEqual({ friendship: 405, love: 1, loveUnlocked: true });
});
it('uses explicit monotonic time, includes the exact boundary and never catches up missed windows', () => {
  const gate = createAdaptationGate(100);
  expect(takeAdaptationOpportunity(gate, 300099, true).accepted).toBe(false);
  expect(takeAdaptationOpportunity(gate, 300100, true)).toEqual({ accepted: true, gate: { nextEligibleAtMs: 600100 } });
  expect(takeAdaptationOpportunity(gate, 3_600_000, true).gate.nextEligibleAtMs).toBe(3_900_000);
  for (const time of [NaN, Infinity, -1, 10]) expect(takeAdaptationOpportunity(gate, time, true).accepted).toBe(false);
});
it('keeps immediate Needs effects but gives no extra axes experience to provider replies or uncompleted play', () => {
  const state = new CharacterStateService().getState(), gate = createAdaptationGate(0);
  const reply = processStimulusWithAdaptation(state, { type: 'provider_response', source: 'provider' }, gate, 300000);
  expect(reply.state.needs.attention).toBeLessThan(state.needs.attention); expect(reply.state.personality.axes).toEqual(state.personality.axes); expect(reply.gate).toBe(gate);
  const play = processStimulusWithAdaptation(state, { type: 'play', source: 'user' }, gate, 300000); expect(play.gate).toBe(gate);
  const actual = processStimulusWithAdaptation(state, { type: 'play', source: 'system', metadata: { activityRunId: 'completed' } }, gate, 300000);
  expect(actual.state.personality.axes.playfulness.current).toBeGreaterThan(state.personality.axes.playfulness.current); expect(actual.gate.nextEligibleAtMs).toBe(600000);
});
it('caps raw axis movement and weight before soft resistance and immutable hard bounds', () => {
  const state = new CharacterStateService().getState(); const axes = { ...state.personality.axes, boldness: { base: 0.5, current: 0.61, softMin: 0.4, softMax: 0.6, hardMin: 0.2, hardMax: 0.65, plasticity: 1 } };
  const next = adaptBoundedExperienceAxes(axes, { boldness: 100 }, 100);
  expect(next.boldness.current).toBeCloseTo(0.6114); expect(next.boldness.base).toBe(axes.boldness.base); expect(axes.boldness.current).toBe(0.61);
  const atLimit = { ...axes, boldness: { ...axes.boldness, current: 0.65 } };
  expect(adaptBoundedExperienceAxes(atLimit, { boldness: 100 }).boldness.current).toBe(0.65);
});
it('keeps preference affinity/sample count bounded and derives confidence from samples', () => {
  const preferences = { 'activity.cursor_game': { value: 99, samples: 1000, confidence: 0.8 } };
  const next = learnVerifiedCursorPreference(preferences, 'like', createAdaptationGate(0), 300000);
  expect(next.preferences['activity.cursor_game']).toEqual({ value: 99.05, samples: 1000, confidence: 1000 / 1006 });
  expect(preferences['activity.cursor_game'].value).toBe(99);
});
