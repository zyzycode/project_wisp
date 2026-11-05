import { expect, it } from 'vitest';
import { directCausalExpression, causalVisualExpression } from '../../src/domain/character/causal-director';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import type { CausalEmotion } from '../../src/domain/character/causal-affect';
import { CausalExpressionRuntime, type CausalDirectorState } from '../../src/application/services/causal-expression-runtime';

const emotion: CausalEmotion = { activity: 'cursor_game' as const, causeSequence: 2, cause: 'user_interrupted', kind: 'irritated', intensity: .3, target: 'user' };
it('chooses the local intent and bounded semantics without changing the observed emotion', () => {
  const before = { ...emotion };
  const decision = directCausalExpression(emotion, true, 'emerging')!;
  expect(decision).toEqual({ sourceSequence: 2, expression: { activity: 'cursor_game' as const, intent: 'give_space', emotion: 'irritated', intensity: 'moderate',
    target: 'user', cause: 'user_interrupted', deferredInvitation: true, ownActivityInterest: 'emerging' } });
  expect(directCausalExpression({ ...emotion, intensity: .1 }, false, 'none')?.expression.intent).toBe('acknowledge');
  expect(directCausalExpression(null, false, 'none')).toBeUndefined();
  expect(directCausalExpression({ ...emotion, cause: 'unknown' }, false, 'none')).toBeUndefined();
  expect(directCausalExpression({ ...emotion, intensity: NaN }, false, 'none')).toBeUndefined();
  expect(emotion).toEqual(before);
});
it('captures semantic bands, owner, source, generation and consent but not continuous numeric decay', () => {
  let state: CausalDirectorState = { generation: 1, owner: 'owner', activeRunId: null, consent: false, romanceAllowed: false,
    emotion, deferredInvitation: false, ownGameInterest: 'none' };
  const runtime = new CausalExpressionRuntime({ now: () => 100, read: () => state });
  const captured = runtime.capture('r')!;
  expect(captured.deadlineMs).toBe(5100); expect(captured.voiceProsody).toBe('neutral');
  state = { ...state, emotion: { ...emotion, intensity: .25 } }; expect(runtime.isCurrent(captured)).toBe(true);
  for (const change of [{ generation: 2 }, { owner: 'other' }, { activeRunId: 'run' }, { consent: true },
    { romanceAllowed: true }, { deferredInvitation: true }, { ownGameInterest: 'emerging' as const },
    { emotion: { ...emotion, activity: 'cursor_game' as const, causeSequence: 3 } }, { emotion: { ...emotion, intensity: .1 } }, { emotion: null }]) {
    const before = state; state = { ...state, ...change }; expect(runtime.isCurrent(captured)).toBe(false); state = before;
  }
});
it('uses existing body hints with no prop and explicit neutral voice fallback, preserving stronger owners', () => {
  const expression = directCausalExpression(emotion, false, 'none')!.expression;
  const intent = createSystemAnimationIntent('idle_blink', 'affectionate', { propHint: 'heart' });
  const gate = { forced: false, awake: true, priority: null };
  expect(causalVisualExpression(intent, expression, gate)).toMatchObject({ expressionHint: 'pout', emotionalTone: 'neutral', propHint: 'none' });
  for (const priority of ['P0_forced_physics', 'P1_user_interaction', 'P2_critical_need', 'P3_reactive'] as const)
    expect(causalVisualExpression(intent, expression, { ...gate, priority })).toBe(intent);
  expect(causalVisualExpression(intent, expression, { ...gate, forced: true })).toBe(intent);
  expect(causalVisualExpression(intent, expression, { ...gate, awake: false })).toBe(intent);
});
