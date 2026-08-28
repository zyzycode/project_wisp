import { describe, expect, it } from 'vitest';
import { mapBehaviorIntentToAnimationIntent } from '../../src/domain/animation';
import type {
  AnimationExpressionHint,
  AnimationIntentCategory,
  AnimationIntentKind,
  AnimationPriority,
  AnimationPropHint,
} from '../../src/domain/animation';
import type { BehaviorIntent, BehaviorIntentKind } from '../../src/domain/behavior/behavior-intent';
import type { SynthesizedEmotionalTone } from '../../src/domain/character';

const TONES: readonly SynthesizedEmotionalTone[] = [
  'shy',
  'sleepy',
  'playful',
  'curious',
  'neutral',
  'affectionate',
  'flustered',
];
const BEHAVIOR_KINDS = [
  'respond',
  'think',
  'react_happy',
  'react_confused',
  'play',
  'sleep',
  'wake',
  'drag',
  'land',
  'wander',
  'idle',
  'quiet',
] as const;

type Tone = SynthesizedEmotionalTone;
type BehaviorKind = (typeof BEHAVIOR_KINDS)[number];

interface ExpectedMapping {
  readonly kind: AnimationIntentKind;
  readonly expressionHint: AnimationExpressionHint;
  readonly propHint: AnimationPropHint;
}

const EXPECTED_MATRIX: Record<BehaviorKind, Record<Tone, ExpectedMapping>> = {
  respond: {
    shy: { kind: 'talking', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'talking', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'talking', expressionHint: 'winking', propHint: 'sparkle' },
    curious: { kind: 'talking', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'talking', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'talking', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'talking', expressionHint: 'blush', propHint: 'heart' },
  },
  think: {
    shy: { kind: 'thinking_loop', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'thinking_loop', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'sparkle' },
    curious: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none' },
    affectionate: { kind: 'thinking_loop', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'thinking_loop', expressionHint: 'blush', propHint: 'heart' },
  },
  react_happy: {
    shy: { kind: 'happy_reaction', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'happy_reaction', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'happy_reaction', expressionHint: 'winking', propHint: 'sparkle' },
    curious: { kind: 'happy_reaction', expressionHint: 'curious', propHint: 'none' },
    neutral: { kind: 'happy_reaction', expressionHint: 'happy', propHint: 'none' },
    affectionate: { kind: 'happy_reaction', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'happy_reaction', expressionHint: 'blush', propHint: 'heart' },
  },
  react_confused: {
    shy: { kind: 'confused_reaction', expressionHint: 'blush', propHint: 'question' },
    sleepy: { kind: 'confused_reaction', expressionHint: 'sleepy', propHint: 'question' },
    playful: { kind: 'confused_reaction', expressionHint: 'surprised', propHint: 'sparkle' },
    curious: { kind: 'confused_reaction', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'confused_reaction', expressionHint: 'surprised', propHint: 'question' },
    affectionate: { kind: 'confused_reaction', expressionHint: 'pout', propHint: 'heart' },
    flustered: { kind: 'confused_reaction', expressionHint: 'blush', propHint: 'heart' },
  },
  play: {
    shy: { kind: 'happy_reaction', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'happy_reaction', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'walk', expressionHint: 'winking', propHint: 'sparkle' },
    curious: { kind: 'walk', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'walk', expressionHint: 'happy', propHint: 'none' },
    affectionate: { kind: 'happy_reaction', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'happy_reaction', expressionHint: 'blush', propHint: 'heart' },
  },
  sleep: {
    shy: { kind: 'sleep_start', expressionHint: 'blush', propHint: 'pillow' },
    sleepy: { kind: 'sleep_start', expressionHint: 'sleepy', propHint: 'pillow' },
    playful: { kind: 'sleep_start', expressionHint: 'sleepy', propHint: 'pillow' },
    curious: { kind: 'sleep_start', expressionHint: 'sleepy', propHint: 'pillow' },
    neutral: { kind: 'sleep_start', expressionHint: 'sleepy', propHint: 'pillow' },
    affectionate: { kind: 'sleep_start', expressionHint: 'happy', propHint: 'pillow' },
    flustered: { kind: 'sleep_start', expressionHint: 'blush', propHint: 'pillow' },
  },
  wake: {
    shy: { kind: 'wake_up', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'wake_up', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'wake_up', expressionHint: 'winking', propHint: 'none' },
    curious: { kind: 'wake_up', expressionHint: 'curious', propHint: 'none' },
    neutral: { kind: 'wake_up', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'wake_up', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'wake_up', expressionHint: 'blush', propHint: 'none' },
  },
  drag: {
    shy: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    sleepy: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    playful: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    curious: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    neutral: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    affectionate: { kind: 'dragged', expressionHint: 'surprised', propHint: 'none' },
    flustered: { kind: 'dragged', expressionHint: 'surprised', propHint: 'heart' },
  },
  land: {
    shy: { kind: 'land', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'land', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'land', expressionHint: 'happy', propHint: 'none' },
    curious: { kind: 'land', expressionHint: 'curious', propHint: 'none' },
    neutral: { kind: 'land', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'land', expressionHint: 'happy', propHint: 'none' },
    flustered: { kind: 'land', expressionHint: 'blush', propHint: 'none' },
  },
  wander: {
    shy: { kind: 'walk', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'walk', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'walk', expressionHint: 'winking', propHint: 'sparkle' },
    curious: { kind: 'walk', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'walk', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'walk', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'walk', expressionHint: 'blush', propHint: 'heart' },
  },
  idle: {
    shy: { kind: 'idle_blink', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'idle_blink', expressionHint: 'sleepy', propHint: 'none' },
    playful: { kind: 'idle_blink', expressionHint: 'winking', propHint: 'sparkle' },
    curious: { kind: 'idle_blink', expressionHint: 'curious', propHint: 'question' },
    neutral: { kind: 'idle_blink', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'idle_blink', expressionHint: 'happy', propHint: 'heart' },
    flustered: { kind: 'idle_blink', expressionHint: 'blush', propHint: 'heart' },
  },
  quiet: {
    shy: { kind: 'idle_blink', expressionHint: 'blush', propHint: 'none' },
    sleepy: { kind: 'sleep_loop', expressionHint: 'sleepy', propHint: 'pillow' },
    playful: { kind: 'idle_blink', expressionHint: 'idle', propHint: 'none' },
    curious: { kind: 'idle_blink', expressionHint: 'curious', propHint: 'none' },
    neutral: { kind: 'idle_blink', expressionHint: 'idle', propHint: 'none' },
    affectionate: { kind: 'idle_blink', expressionHint: 'happy', propHint: 'none' },
    flustered: { kind: 'idle_blink', expressionHint: 'blush', propHint: 'none' },
  },
};

const EXPECTED_POLICY: Record<AnimationIntentKind, {
  readonly category: AnimationIntentCategory;
  readonly priority: AnimationPriority;
}> = {
  idle_blink: { category: 'idle', priority: 'low' },
  thinking_loop: { category: 'dialogue', priority: 'normal' },
  talking: { category: 'dialogue', priority: 'normal' },
  happy_reaction: { category: 'reaction', priority: 'normal' },
  confused_reaction: { category: 'reaction', priority: 'normal' },
  sleep_start: { category: 'sleep', priority: 'high' },
  sleep_loop: { category: 'sleep', priority: 'high' },
  wake_up: { category: 'transition', priority: 'high' },
  dragged: { category: 'movement', priority: 'critical' },
  spook: { category: 'reaction', priority: 'critical' },
  land: { category: 'transition', priority: 'high' },
  walk: { category: 'movement', priority: 'normal' },
  settle: { category: 'transition', priority: 'low' },
};

function behaviorIntent(kind: BehaviorIntentKind): BehaviorIntent {
  return {
    kind,
    source: kind === 'idle' || kind === 'wander' ? 'timer' : 'user',
    priority: kind === 'drag' ? 'critical' : 'normal',
  };
}

describe('Domain: AnimationIntent mapping', () => {
  it('maps every BehaviorIntentKind and SynthesizedEmotionalTone pair to the contract matrix', () => {
    for (const behaviorKind of BEHAVIOR_KINDS) {
      for (const tone of TONES) {
        const intent = mapBehaviorIntentToAnimationIntent(behaviorIntent(behaviorKind), tone);
        const expected = EXPECTED_MATRIX[behaviorKind][tone];
        const expectedPolicy = EXPECTED_POLICY[expected.kind];

        expect(intent).toMatchObject({
          ...expected,
          category: expectedPolicy.category,
          priority: expectedPolicy.priority,
          requestedBy: behaviorKind,
          emotionalTone: tone,
        });
      }
    }
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
