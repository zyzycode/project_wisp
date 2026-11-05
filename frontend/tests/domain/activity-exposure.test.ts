import { expect, it } from 'vitest';
import { createActivityExposure, cursorGameSatiationMultiplier, observeActivityExposure, recoverActivityExposure } from '../../src/domain/character/activity-exposure';
import type { CausalObservedEvent } from '../../src/domain/character/causal-affect';

const contact: CausalObservedEvent = { sequence: 1, source: 'user', triggerSequence: null, activityRunId: null, activity: null,
  outcome: null, cause: 'contact', executedMs: 0, participation: 'none' };
const terminal: CausalObservedEvent = { ...contact, activityRunId: 'game', activity: 'cursor_game', outcome: 'cancelled', cause: 'other', executedMs: 30_000 };

it('charges actual terminal execution once and restores temporary appeal without changing a preference', () => {
  const initial = createActivityExposure();
  const played = observeActivityExposure(initial, terminal, 0);
  expect(played.satiation).toBe(.5);
  expect(observeActivityExposure(played, terminal, 1_000)).toBe(played);
  expect(observeActivityExposure(played, { ...terminal, sequence: 2, executedMs: 600_000 }, 0).satiation).toBe(1);
  expect(observeActivityExposure(initial, { ...terminal, executedMs: 0 }, 0).satiation).toBe(0);
  expect(recoverActivityExposure(played, 30_000).satiation).toBeCloseTo(.4);
  expect(recoverActivityExposure(played, 300_000).satiation).toBeCloseTo(.3);
  expect(cursorGameSatiationMultiplier(played.satiation)).toBe(.625);
  expect(cursorGameSatiationMultiplier(undefined)).toBe(1);
});

it('counts only safe contact and recovers one step per continuous 30 seconds', () => {
  let state = createActivityExposure();
  for (let sequence = 1; sequence <= 7; sequence++) state = observeActivityExposure(state, { ...contact, sequence }, sequence);
  expect(state.habituation).toBe(4);
  expect(recoverActivityExposure(state, 30_000).habituation).toBe(4);
  state = recoverActivityExposure(state, 30_001);
  expect(state.habituation).toBe(3);
  expect(recoverActivityExposure(state, 60_001).habituation).toBe(2);
  expect(recoverActivityExposure(state, 150_001).habituation).toBe(0);
  expect(observeActivityExposure(state, { ...terminal, sequence: 8, cause: 'user_interrupted', source: 'user', triggerSequence: 7 }, 30_001).habituation).toBe(3);
});

it('ignores invalid time and replay and starts neutrally after reset/restart', () => {
  const state = observeActivityExposure(createActivityExposure(), terminal, 10);
  expect(recoverActivityExposure(state, 9)).toBe(state);
  expect(recoverActivityExposure(state, NaN)).toBe(state);
  expect(observeActivityExposure(state, { ...terminal, sequence: 2, executedMs: NaN }, 20)).toBe(state);
  expect(createActivityExposure()).toMatchObject({ satiation: 0, habituation: 0 });
});
