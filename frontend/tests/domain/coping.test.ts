import { expect, it } from 'vitest';
import { cancelCoping, commitCoping, considerCoping, createCopingState, finishCoping, observeCoping, selectCoping } from '../../src/domain/character/coping';
import type { CausalEmotion } from '../../src/domain/character/causal-affect';
const episode = { appRunId: 'app', sequence: 2, revision: 1 as const, source: 'user' as const, triggerSequence: 1,
  activityRunId: 'game', activity: 'cursor_game' as const, outcome: 'cancelled' as const,
  cause: 'user_interrupted' as const, executedMs: 1000, participation: 'user_engaged' as const };
const emotion: CausalEmotion = { causeSequence: 2, cause: 'user_interrupted', kind: 'irritated', intensity: .3, target: 'user' };
const context = { nowMs: 1000, generation: 0, appRunId: 'app', emotion, free: true, menu: false, blocked: false,
  interpretation: 'unknown' as const, comfort: 500 };
const observed = () => observeCoping(createCopingState(), episode, emotion, 1000, 0);
it('chooses pause or explore from attributed context, retaining the original deadline', () => {
  const state = observed();
  expect(considerCoping(state, context).choice).toMatchObject({ strategy: 'pause', expiresAtMs: 31000 });
  expect(considerCoping(state, { ...context, interpretation: 'reported_accidental' }).choice?.strategy).toBe('explore');
  expect(considerCoping(state, { ...context, interpretation: 'reported_accidental', comfort: 499 }).choice?.strategy).toBe('pause');
  expect(considerCoping(state, { ...context, interpretation: 'contradicted' }).choice?.strategy).toBe('pause');
});
it('omits at expiry or hard gates, lets menu/peer wait, and never offers a second consideration', () => {
  const state = observed();
  expect(considerCoping(state, { ...context, nowMs: 31000 }).choice).toBeNull();
  expect(considerCoping(state, { ...context, blocked: true }).opportunity).toBeNull();
  expect(considerCoping(state, { ...context, menu: true }).opportunity).toEqual(state.opportunity);
  expect(considerCoping(state, { ...context, free: false }).opportunity).toEqual(state.opportunity);
  const first = considerCoping(state, context);
  expect(considerCoping(first, { ...context, nowMs: 1100 }).choice).toBeNull();
});
it('only a genuinely boosted selected run can pay one completed relief', () => {
  const selected = selectCoping(considerCoping(observed(), context), 'idle', true);
  const running = commitCoping(selected, 'calm', 'calm', context);
  expect(finishCoping(running, 'other', true, context).relief).toBeNull();
  expect(finishCoping(running, 'calm', false, context).relief).toBeNull();
  const done = finishCoping(running, 'calm', true, { ...context, nowMs: 35000 });
  expect(done.relief).toEqual({ appRunId: 'app', sequence: 2, revision: 1 });
  expect(finishCoping(done.state, 'calm', true, context).relief).toBeNull();
  expect(commitCoping(selectCoping(considerCoping(observed(), context), 'idle', false), 'calm', 'calm', context).run).toBeNull();
  expect(commitCoping(selectCoping(considerCoping(observed(), context), 'wander', true), 'wander', 'explore', context).run).toBeNull();
});
it('does not replay a cancelled opportunity or restore relief after generation/source changes', () => {
  const state = observed(); expect(observeCoping(cancelCoping(state), episode, emotion, 1000, 0).opportunity).toBeNull();
  const running = commitCoping(selectCoping(considerCoping(state, context), 'idle', true), 'calm', 'calm', context);
  for (const changed of [{ ...context, generation: 1 }, { ...context, appRunId: 'new' }, { ...context, emotion: null },
    { ...context, emotion: { ...emotion, causeSequence: 3 } }]) expect(finishCoping(running, 'calm', true, changed).relief).toBeNull();
});
it('rejects reversed clocks and cannot pay completion before actual run start', () => {
  expect(considerCoping(observed(), { ...context, nowMs: 999 }).choice).toBeNull();
  const running = commitCoping(selectCoping(considerCoping(observed(), context), 'idle', true), 'calm', 'calm', { ...context, nowMs: 2000 });
  expect(finishCoping(running, 'calm', true, { ...context, nowMs: 1500 }).relief).toBeNull();
});
