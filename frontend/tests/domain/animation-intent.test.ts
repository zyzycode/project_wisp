import { describe, expect, it } from 'vitest';
import { mapBehaviorIntentToAnimationIntent } from '../../src/domain/animation';
import type { BehaviorIntent, BehaviorIntentKind } from '../../src/domain/behavior/behavior-intent';

function behaviorIntent(kind: BehaviorIntentKind): BehaviorIntent {
  return {
    kind,
    source: kind === 'idle' || kind === 'wander' ? 'timer' : 'user',
    priority: kind === 'drag' ? 'critical' : 'normal',
  };
}

describe('Domain: AnimationIntent mapping', () => {
  it('lets emotional context distinguish active play from a stationary reaction', () => {
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('play'), 'playful')).toMatchObject({
      kind: 'walk', category: 'movement', requestedBy: 'play', emotionalTone: 'playful',
    });
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('play'), 'shy')).toMatchObject({
      kind: 'happy_reaction', category: 'reaction', requestedBy: 'play', emotionalTone: 'shy',
    });
  });

  it('uses bounded loops for reactions and until-replaced loops for sleep and drag stability', () => {
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('react_happy'), 'playful')).toMatchObject({
      kind: 'happy_reaction',
      loop: 'bounded',
      interrupt: 'yes',
    });
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('sleep'), 'sleepy')).toMatchObject({
      kind: 'sleep_start',
      loop: 'none',
      interrupt: 'limited',
    });
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('quiet'), 'sleepy')).toMatchObject({
      kind: 'sleep_loop',
      loop: 'until_replaced',
      interrupt: 'limited',
    });
    expect(mapBehaviorIntentToAnimationIntent(behaviorIntent('drag'), 'neutral')).toMatchObject({
      kind: 'dragged',
      loop: 'until_replaced',
      interrupt: 'no',
    });
  });
});
