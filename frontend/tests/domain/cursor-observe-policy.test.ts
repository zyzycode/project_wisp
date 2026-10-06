import { describe, expect, it } from 'vitest';
import {
  calculateCursorNoticeChance,
  createCursorObserveActivity,
  createCursorObserveActivityCandidates,
  DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS,
  EMPTY_COOLDOWNS,
  resolveCursorObserve,
  selectActivityForResolvedIntent,
  triggerCooldown,
  type ActivitySelectionContext,
  type CursorObserveInput,
  type CursorProximitySignal,
} from '../../src/domain/behavior';

function signal(distance: number, capturedAtMs = 0): CursorProximitySignal {
  return {
    cursor: { globalPosition: { x: distance, y: 0 }, capturedAtMs },
    distanceToRootWorldPx: distance,
    withinAttentionRange: distance <= 360,
    withinSwatRange: distance <= 64,
    dwellWithinSwatRangeMs: 0,
    emittedAtMs: capturedAtMs,
  };
}

function input(overrides: Partial<CursorObserveInput> = {}): CursorObserveInput {
  return {
    nowMs: 0,
    signal: signal(100),
    needs: { energy: 80, attention: 20, play: 20, comfort: 20, boredom: 20 },
    tone: 'neutral',
    friendship: 0,
    noticeRandomUnit: 0,
    ...overrides,
  };
}

const playIntent = {
  kind: 'play', source: 'system', priority: 'normal', reason: 'cursor_observe',
} as const;

function selectionContext(
  cursorInput: CursorObserveInput,
  overrides: Partial<ActivitySelectionContext> = {}
): ActivitySelectionContext {
  return {
    character: { needs: cursorInput.needs },
    synthesizedTone: cursorInput.tone,
    environment: {
      capturedAtMs: cursorInput.nowMs,
      screenBounds: { id: 'primary', x: 0, y: 0, width: 1_000, height: 800 },
    },
    repetition: { activities: [], actions: [] },
    cooldowns: EMPTY_COOLDOWNS,
    ...overrides,
  };
}

function selectedReaction(
  cursorInput: CursorObserveInput,
  zone: 'contact' | 'near' | 'ambient' | 'far' = 'near',
  randomUnit = 0
): string | undefined {
  const candidates = createCursorObserveActivityCandidates({
    zone,
    needs: cursorInput.needs,
    tone: cursorInput.tone,
    friendship: cursorInput.friendship,
    gazeDirection: 'right',
  });
  return selectActivityForResolvedIntent(
    playIntent,
    selectionContext(cursorInput),
    cursorInput.nowMs,
    randomUnit,
    { play: candidates }
  )?.steps[0]?.actionId;
}

describe('Domain: Observe Cursor policy', () => {
  it('biases only an eligible game with the existing draw and clamps the resulting chance', () => {
    const opportunity = input({ gameCandidateEligible: true, noticeRandomUnit: 0.55 });
    const liked = resolveCursorObserve({ ...opportunity, learnedGamePreference: { value: 100, confidence: 0.5 } });
    const disliked = resolveCursorObserve({ ...opportunity, learnedGamePreference: { value: -100, confidence: 0.5 } });
    expect(liked.noticeChance).toBeCloseTo(0.652);
    expect(disliked.noticeChance).toBeCloseTo(0.452);
    expect(liked.noticed).toBe(true); expect(disliked.noticed).toBe(false);
    expect(resolveCursorObserve(input({ signal: signal(20), tone: 'playful', friendship: 900,
      gameCandidateEligible: true, learnedGamePreference: { value: 100, confidence: 1 } })).noticeChance).toBe(1);
    expect(resolveCursorObserve(input({ signal: signal(500), gameCandidateEligible: true,
      learnedGamePreference: { value: -100, confidence: 1 } })).noticeChance).toBe(0);
  });

  it.each([
    undefined, { value: 100, confidence: 0.499 }, { value: 101, confidence: 1 },
    { value: -101, confidence: 1 }, { value: NaN, confidence: 1 },
    { value: 100, confidence: Infinity }, { value: 100, confidence: 1.1 },
    { value: 100, confidence: -0.1 },
  ])('preserves the exact baseline for an absent or invalid track: %j', learnedGamePreference => {
    const baseline = resolveCursorObserve(input());
    expect(resolveCursorObserve(input({ gameCandidateEligible: true, learnedGamePreference }))).toEqual(baseline);
  });

  it('keeps passive reactions unchanged and cannot rescue stale or missing signals', () => {
    const preference = { value: 100, confidence: 1 };
    for (const gameCandidateEligible of [undefined, false]) {
      expect(resolveCursorObserve(input({ gameCandidateEligible, learnedGamePreference: preference })))
        .toEqual(resolveCursorObserve(input()));
    }
    for (const cursorSignal of [undefined, signal(20, -301), signal(20, 1)]) {
      expect(resolveCursorObserve(input({ signal: cursorSignal, gameCandidateEligible: true,
        learnedGamePreference: preference }))).toEqual({ noticed: false, noticeChance: 0 });
    }
  });

  it('notices a nearby cursor more often and rejects missing, stale, or usually-far signals', () => {
    const near = resolveCursorObserve(input({ signal: signal(100), noticeRandomUnit: 0.3 }));
    const far = resolveCursorObserve(input({ signal: signal(1_000), noticeRandomUnit: 0.3 }));
    const stale = resolveCursorObserve(input({ nowMs: 301, signal: signal(100, 0) }));
    const missing = resolveCursorObserve(input({ signal: undefined }));

    expect(near.noticed).toBe(true);
    expect(far.noticed).toBe(false);
    expect(near.noticeChance).toBeGreaterThan(far.noticeChance);
    expect(stale.noticed).toBe(false);
    expect(missing.noticed).toBe(false);
  });

  it.each([
    ['fatigue', input({ needs: { energy: 20, attention: 0, play: 100, comfort: 0, boredom: 100 } }), 'near', 'gaze_only'],
    ['curiosity', input({ tone: 'curious' }), 'near', 'head_tilt'],
    ['playfulness', input({ tone: 'playful' }), 'near', 'point'],
    ['friendship', input({ friendship: 800 }), 'near', 'greeting'],
    ['close approach', input({ signal: signal(20) }), 'contact', 'reach'],
  ] as const)('selects the %s state variant in Behavior Brain', (
    _label,
    reactionInput,
    zone,
    expected
  ) => {
    expect(selectedReaction(reactionInput, zone, 0)).toBe(`observe_cursor:${expected}`);
  });

  it('uses shared Activity cooldown/repetition while strong context only raises notice chance', () => {
    const neutralChance = calculateCursorNoticeChance(
      'near',
      input({ nowMs: 25_000 })
    );
    const strongChance = calculateCursorNoticeChance(
      'near',
      input({
        nowMs: 25_000,
        tone: 'playful',
        friendship: 900,
        needs: { energy: 100, attention: 0, play: 100, comfort: 0, boredom: 100 },
      })
    );
    expect(strongChance).toBeGreaterThan(neutralChance);

    const curious = input({ nowMs: 25_000, tone: 'curious' });
    const candidates = createCursorObserveActivityCandidates({
      zone: 'near', needs: curious.needs, tone: curious.tone,
      friendship: curious.friendship, gazeDirection: 'right',
    });
    const fresh = selectActivityForResolvedIntent(
      playIntent, selectionContext(curious), 25_000, 0.2, { play: candidates }
    );
    const repeated = selectActivityForResolvedIntent(
      playIntent,
      selectionContext(curious, {
        repetition: {
          activities: [],
          actions: [{
            actionId: 'observe_cursor:head_tilt',
            animationKind: 'thinking_loop',
            shownAtMs: 25_000,
          }],
        },
      }),
      25_000,
      0.2,
      { play: candidates }
    );
    expect(fresh?.steps[0]?.actionId).toBe('observe_cursor:head_tilt');
    expect(repeated?.steps[0]?.actionId).not.toBe('observe_cursor:head_tilt');

    const cooldowns = triggerCooldown(EMPTY_COOLDOWNS, {
      key: 'observe_cursor',
      durationMs: DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS,
      startsOn: 'start',
    }, 'start', 25_000);
    expect(selectActivityForResolvedIntent(
      playIntent,
      selectionContext(curious, { cooldowns }),
      25_000 + DEFAULT_CURSOR_OBSERVE_COOLDOWN_MS - 1,
      0,
      { play: candidates }
    )).toBeNull();
  });

  it('builds a single stationary Brain Activity with existing visual fallbacks', () => {
    const gaze = createCursorObserveActivity('gaze_only', 'right');
    const head = createCursorObserveActivity('head_tilt');
    const point = createCursorObserveActivity('point');
    const reach = createCursorObserveActivity('reach');
    const greeting = createCursorObserveActivity('greeting');

    expect(gaze.steps[0]).toMatchObject({
      type: 'animation',
      intent: { kind: 'idle_blink', expressionHint: 'gaze', gazeDirection: 'right' },
    });
    expect(head.steps[0]).toMatchObject({ type: 'animation', intent: { kind: 'thinking_loop' } });
    expect(point.steps[0]).toMatchObject({ type: 'animation', intent: { kind: 'thinking_loop' } });
    expect(reach.steps[0]).toMatchObject({ type: 'animation', intent: { kind: 'wave' } });
    expect(greeting.steps[0]).toMatchObject({ type: 'animation', intent: { kind: 'wave' } });
    expect([gaze, head, point, reach, greeting].every(
      (definition) => definition.steps.every((step) => step.type !== 'locomotion')
    )).toBe(true);
  });
});
