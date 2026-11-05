import { expect, it } from 'vitest';
import { resolveCursorObserve, type CursorObserveInput } from '../../src/domain/behavior/cursor-observe-policy';
import { repetitionModifier, selectActivityForResolvedIntent, ZOOMIES_ACTIVITY, type ActivityDefinition, type ActivitySelectionContext } from '../../src/domain/behavior/activity-runner';

const input: CursorObserveInput = { nowMs: 0, signal: { cursor: { globalPosition: { x: 30, y: 0 }, capturedAtMs: 0 },
  distanceToRootWorldPx: 30, withinAttentionRange: true, withinSwatRange: true, dwellWithinSwatRangeMs: 500, emittedAtMs: 0 },
  needs: { energy: 80, attention: 20, play: 70, comfort: 20, boredom: 20 }, tone: 'neutral', friendship: 0,
  gameCandidateEligible: true, learnedGamePreference: { value: 100, confidence: 1 }, noticeRandomUnit: .5 };
const game: ActivityDefinition = { id: 'cursor_interest', priority: 'P3_reactive', baseWeight: 1, cooldownKey: 'observe_cursor', entryStepId: 'notice',
  steps: [{ id: 'notice', actionId: 'notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' }, completion: { type: 'elapsed', durationMs: 600 } }] };

it('uses one bounded multiplier only for the currently eligible game, preserving learned preference and passive noticing', () => {
  const fresh = resolveCursorObserve(input);
  const satiated = resolveCursorObserve({ ...input, cursorGameSatiation: 1 });
  expect(satiated.noticeChance).toBeCloseTo(fresh.noticeChance * .25);
  expect(fresh.noticed).toBe(true); expect(satiated.noticed).toBe(false);
  expect(resolveCursorObserve({ ...input, cursorGameSatiation: 1, noticeRandomUnit: satiated.noticeChance }).noticed).toBe(false);
  for (const cursorGameSatiation of [NaN, Infinity, undefined, 0]) expect(resolveCursorObserve({ ...input, cursorGameSatiation })).toEqual(fresh);
  expect(resolveCursorObserve({ ...input, cursorGameSatiation: 1, gameCandidateEligible: false }))
    .toEqual(resolveCursorObserve({ ...input, gameCandidateEligible: false }));
  expect(input.learnedGamePreference).toEqual({ value: 100, confidence: 1 });
});

it('replaces cursor-game repetition without changing other repetition or bypassing hard cooldown', () => {
  const repetition = { activities: [{ activityId: 'cursor_interest', selectedAtMs: 0, result: 'cancelled' as const }],
    actions: [{ actionId: 'notice', animationKind: 'look_around' as const, shownAtMs: 0 }] };
  expect(repetitionModifier(game, repetition, 0)).toBe(1);
  expect(repetitionModifier({ ...game, id: 'other' }, repetition, 0)).toBeLessThan(1);
  expect(repetitionModifier(ZOOMIES_ACTIVITY, { activities: [{ activityId: 'zoomies', selectedAtMs: 0, result: 'completed' }], actions: [] }, 0)).toBeLessThan(1);
  const context: ActivitySelectionContext = { character: { needs: input.needs }, synthesizedTone: input.tone,
    environment: { capturedAtMs: 0, screenBounds: { id: 'primary', x: 0, y: 0, width: 1000, height: 800 } }, repetition,
    cooldowns: { entries: [{ key: 'observe_cursor', nextEligibleAtMs: 5000 }] } };
  const intent = { kind: 'play', source: 'system', priority: 'normal' } as const;
  expect(selectActivityForResolvedIntent(intent, context, 4999, 0, { play: [game] })).toBeNull();
  expect(selectActivityForResolvedIntent(intent, context, 5000, 0, { play: [game] })).toBe(game);
});
