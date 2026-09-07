import { describe, expect, it } from 'vitest';
import { createSystemAnimationIntent, mapBehaviorIntentToAnimationIntent } from '../../src/domain/animation/animation-intent';
import { isCursorObservationCompatible } from '../../src/renderer/body-ui-runtime';

describe('ambient expression and cursor gaze', () => {
  it('returns to a neutral face after an explicit happy episode despite affectionate mood', () => {
    const reaction = createSystemAnimationIntent('happy_reaction', 'affectionate', { expressionHint: 'happy' });
    expect(reaction.expressionHint).toBe('happy');
    for (const kind of ['idle_blink', 'look_around', 'settle'] as const) {
      expect(createSystemAnimationIntent(kind, 'affectionate')).toMatchObject({ expressionHint: 'idle', propHint: 'none' });
    }
    expect(mapBehaviorIntentToAnimationIntent({ kind: 'idle', source: 'timer', priority: 'normal' }, 'affectionate'))
      .toMatchObject({ expressionHint: 'idle', propHint: 'none' });
  });

  it('keeps cursor observations enabled during both calm poses', () => {
    for (const visualKind of ['idle_blink', 'look_around']) {
      expect(isCursorObservationCompatible({ autonomyEnabled: true, menuOpen: false, dragging: false,
        motionPhase: 'grounded', activityId: 'calm', visualKind })).toBe(true);
    }
  });
});
