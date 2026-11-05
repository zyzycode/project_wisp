import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { createCharacterSnapshot } from '../../src/domain/character/character-snapshot';
import type { CausalObservedEvent } from '../../src/domain/character/causal-affect';
import { canExpressFlirt } from '../../src/domain/character/intimacy-rules';

const interruption = (sequence: number): CausalObservedEvent => ({ sequence: sequence * 2, source: 'user', triggerSequence: sequence * 2 - 1,
  activityRunId: `run-${sequence}`, activity: 'cursor_game', outcome: 'cancelled', cause: 'user_interrupted',
  executedMs: 1500, participation: 'user_engaged' });
const completed = (sequence: number): CausalObservedEvent => ({ ...interruption(sequence), source: 'autonomy',
  triggerSequence: null, outcome: 'completed', cause: 'completed' });
function fixture(affection = 800) {
  let now = 0;
  const service = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  const initial = service.getState();
  initial.relationship = { ...initial.relationship, friendship: affection, familiarity: affection, affection,
    love: 100, loveUnlocked: true };
  service.replaceRestoredState(initial);
  return { service, time: (value: number) => { now = value; } };
}

it('allows high affection and low affection profiles to feel the same caused resentment without erasing closeness', () => {
  for (const affection of [50, 900]) {
    const f = fixture(affection), before = f.service.getState();
    f.time(30_000); f.service.observeCausalEpisode(interruption(1), 30_000);
    expect(f.service.getState().relationship).toEqual(before.relationship);
    f.time(31_000); f.service.observeCausalEpisode(interruption(2), 31_000);
    expect(f.service.getState().relationship).toEqual({ ...before.relationship, resentment: 1, comfort: 499 });
    expect(f.service.getCausalEmotion()).toMatchObject({ kind: 'irritated' });
    expect(f.service.getCausalEmotion()?.intensity).toBeCloseTo(0.3);
    const once = f.service.getState();
    f.service.observeCausalEpisode(interruption(2), 31_000);
    expect(f.service.getState()).toEqual(once);
    f.time(32_000); f.service.observeCausalEpisode(interruption(3), 32_000);
    expect(f.service.getState().relationship).toEqual(once.relationship);
    f.time(60_000); f.service.tickNeeds(60_000);
    expect(f.service.getState().relationship).toEqual(once.relationship);
    f.time(61_000); f.service.observeCausalEpisode(completed(4), 61_000);
    expect(f.service.getState().relationship).toEqual({ ...before.relationship, affection: affection + 1, trust: 501, comfort: 500, resentment: 1 });
  }
});

it('uses one semantic gate for chat and verified games while keeping play familiarity reward separate', () => {
  const f = fixture(), supportive = { category: 'supportive', confidence: 'clear', intensity: 'low' } as const;
  f.time(30_000);
  expect(f.service.commitChat(f.service.beginChat(1), supportive).effect).toBe('accepted');
  const chat = f.service.getState();
  expect(chat.relationship).toMatchObject({ friendship: 802, familiarity: 802, trust: 501, comfort: 501, respect: 501 });
  f.service.observeCausalEpisode(completed(1), 30_000);
  expect(f.service.getState().relationship).toEqual(chat.relationship);
  f.time(60_000); f.service.observeCausalEpisode(completed(2), 60_000);
  const game = f.service.getState();
  expect(game.relationship).toMatchObject({ friendship: 802, familiarity: 802, affection: 801, trust: 502, comfort: 502 });
  expect(f.service.commitChat(f.service.beginChat(2), supportive).effect).toBe('suppressed');
  f.service.applyStimulus({ type: 'play', metadata: { activityRunId: 'run-2' } });
  expect(f.service.getState().relationship).toEqual({ ...game.relationship, friendship: 805, familiarity: 805 });
});

it('keeps facets local, preserves consent boundaries and resets stable facets only on full reset', () => {
  const f = fixture(900), state = f.service.getState();
  state.relationship = { ...state.relationship, trust: 1000, affection: 1000, resentment: 999, comfort: 1000 };
  f.service.replaceRestoredState(state);
  expect(canExpressFlirt(f.service.getState())).toBe(false);
  expect(createCharacterSnapshot(f.service.getState()).relationship).toEqual({ friendship: 900, love: 100, loveUnlocked: true });
  f.time(30_000); f.service.observeCausalEpisode(completed(1), 30_000);
  expect(f.service.getState().relationship).toMatchObject({ trust: 1000, affection: 1000, comfort: 1000, resentment: 999 });
  const checkpoint = f.service.getState();
  const restarted = new CharacterStateService({ initialState: checkpoint, monotonicNow: () => 30_000 });
  expect(restarted.getState().relationship).toEqual(checkpoint.relationship);
  expect(restarted.getCausalEmotion()).toBeNull();
  restarted.resetToDefaults();
  expect(restarted.getState().relationship).toEqual({ friendship: 0, familiarity: 0, affection: 0, trust: 500, respect: 500, comfort: 500, resentment: 0, love: 0, loveUnlocked: false });
});

it('changes trust, respect and safety from clear chat evidence without erasing affection or inferring consent', () => {
  const f = fixture(), initial = f.service.getState();
  initial.relationship.resentment = 3; f.service.replaceRestoredState(initial);
  f.time(30_000);
  f.service.commitChat(f.service.beginChat(1), { category: 'supportive', intensity: 'moderate', confidence: 'clear' });
  expect(f.service.getState().relationship).toEqual({ ...initial.relationship, friendship: 804, familiarity: 804,
    trust: 501, respect: 501, comfort: 501, resentment: 2 });
  f.time(60_000);
  f.service.commitChat(f.service.beginChat(2), { category: 'hostile', intensity: 'moderate', confidence: 'clear' });
  expect(f.service.getState().relationship).toEqual({ ...initial.relationship, friendship: 802, familiarity: 802, resentment: 2 });
  expect(f.service.getState().intimacy).toEqual(initial.intimacy);
  f.time(90_000); const before = f.service.getState();
  f.service.commitChat(f.service.beginChat(3), { category: 'hostile', intensity: 'moderate', confidence: 'uncertain' });
  expect(f.service.getState().relationship).toEqual(before.relationship);
});
