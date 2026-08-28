import type { BehaviorIntent, BehaviorIntentKind } from '../behavior/behavior-intent';
import type { SynthesizedEmotionalTone } from '../character';

export interface AnimationIntent {
  kind: AnimationIntentKind;
  category: AnimationIntentCategory;
  priority: AnimationPriority;
  interrupt: AnimationInterruptMode;
  loop: AnimationLoopMode;
  requestedBy: BehaviorIntentKind | 'system';
  emotionalTone: SynthesizedEmotionalTone;
  expressionHint?: AnimationExpressionHint;
  propHint?: AnimationPropHint;
}

export type AnimationIntentKind =
  | 'idle_blink'
  | 'thinking_loop'
  | 'talking'
  | 'happy_reaction'
  | 'confused_reaction'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'dragged'
  | 'spook'
  | 'land'
  | 'walk'
  | 'settle';

export type AnimationIntentCategory =
  | 'idle'
  | 'reaction'
  | 'movement'
  | 'dialogue'
  | 'sleep'
  | 'transition';

export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';
export type AnimationInterruptMode = 'yes' | 'no' | 'limited';
export type AnimationLoopMode = 'none' | 'until_replaced' | 'bounded';

export type AnimationExpressionHint =
  | 'blush'
  | 'sleepy'
  | 'happy'
  | 'surprised'
  | 'curious'
  | 'idle'
  | 'winking'
  | 'pout';

export type AnimationPropHint =
  | 'pillow'
  | 'heart'
  | 'question'
  | 'sparkle'
  | 'none';

type ToneHints = {
  readonly expressionHint: AnimationExpressionHint;
  readonly propHint: AnimationPropHint;
};

type IntentPolicy = Pick<AnimationIntent, 'category' | 'priority' | 'interrupt' | 'loop'>;

type HintOverride = Partial<ToneHints>;

type BehaviorMapping = {
  readonly kind: AnimationIntentKind;
  readonly hintsByTone: Record<SynthesizedEmotionalTone, HintOverride>;
};

const TONES: readonly SynthesizedEmotionalTone[] = [
  'shy',
  'sleepy',
  'playful',
  'curious',
  'neutral',
  'affectionate',
  'flustered',
];

const DEFAULT_TONE_HINTS: Record<SynthesizedEmotionalTone, ToneHints> = {
  shy: { expressionHint: 'blush', propHint: 'none' },
  sleepy: { expressionHint: 'sleepy', propHint: 'none' },
  playful: { expressionHint: 'winking', propHint: 'sparkle' },
  curious: { expressionHint: 'curious', propHint: 'question' },
  neutral: { expressionHint: 'idle', propHint: 'none' },
  affectionate: { expressionHint: 'happy', propHint: 'heart' },
  flustered: { expressionHint: 'blush', propHint: 'heart' },
};

const INTENT_POLICIES: Record<AnimationIntentKind, IntentPolicy> = {
  idle_blink: { category: 'idle', priority: 'low', interrupt: 'yes', loop: 'bounded' },
  thinking_loop: { category: 'dialogue', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  talking: { category: 'dialogue', priority: 'normal', interrupt: 'yes', loop: 'bounded' },
  happy_reaction: { category: 'reaction', priority: 'normal', interrupt: 'yes', loop: 'bounded' },
  confused_reaction: { category: 'reaction', priority: 'normal', interrupt: 'yes', loop: 'bounded' },
  sleep_start: { category: 'sleep', priority: 'high', interrupt: 'limited', loop: 'none' },
  sleep_loop: { category: 'sleep', priority: 'high', interrupt: 'limited', loop: 'until_replaced' },
  wake_up: { category: 'transition', priority: 'high', interrupt: 'no', loop: 'none' },
  dragged: { category: 'movement', priority: 'critical', interrupt: 'no', loop: 'until_replaced' },
  spook: { category: 'reaction', priority: 'critical', interrupt: 'no', loop: 'bounded' },
  land: { category: 'transition', priority: 'high', interrupt: 'no', loop: 'none' },
  walk: { category: 'movement', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  settle: { category: 'transition', priority: 'low', interrupt: 'yes', loop: 'none' },
};

function hints(overrides: Partial<Record<SynthesizedEmotionalTone, HintOverride>>): Record<SynthesizedEmotionalTone, HintOverride> {
  return TONES.reduce<Record<SynthesizedEmotionalTone, HintOverride>>((mapping, tone) => {
    mapping[tone] = overrides[tone] ?? {};
    return mapping;
  }, {} as Record<SynthesizedEmotionalTone, HintOverride>);
}

const BEHAVIOR_MAPPINGS: Record<BehaviorIntentKind, BehaviorMapping> = {
  respond: {
    kind: 'talking',
    hintsByTone: hints({}),
  },
  think: {
    kind: 'thinking_loop',
    hintsByTone: hints({
      playful: { expressionHint: 'curious' },
      neutral: { expressionHint: 'curious' },
    }),
  },
  react_happy: {
    kind: 'happy_reaction',
    hintsByTone: hints({
      curious: { propHint: 'none' },
      neutral: { expressionHint: 'happy' },
    }),
  },
  react_confused: {
    kind: 'confused_reaction',
    hintsByTone: hints({
      shy: { propHint: 'question' },
      sleepy: { propHint: 'question' },
      playful: { expressionHint: 'surprised' },
      neutral: { expressionHint: 'surprised', propHint: 'question' },
      affectionate: { expressionHint: 'pout' },
      curious: {},
      flustered: {},
    }),
  },
  play: {
    kind: 'happy_reaction',
    hintsByTone: hints({
      playful: { expressionHint: 'winking', propHint: 'sparkle' },
      curious: { expressionHint: 'curious', propHint: 'question' },
      neutral: { expressionHint: 'happy' },
    }),
  },
  sleep: {
    kind: 'sleep_start',
    hintsByTone: hints({
      shy: { propHint: 'pillow' },
      sleepy: { propHint: 'pillow' },
      playful: { expressionHint: 'sleepy', propHint: 'pillow' },
      curious: { expressionHint: 'sleepy', propHint: 'pillow' },
      neutral: { expressionHint: 'sleepy', propHint: 'pillow' },
      affectionate: { propHint: 'pillow' },
      flustered: { propHint: 'pillow' },
    }),
  },
  wake: {
    kind: 'wake_up',
    hintsByTone: hints({
      playful: { propHint: 'none' },
      curious: { propHint: 'none' },
      flustered: { propHint: 'none' },
    }),
  },
  drag: {
    kind: 'dragged',
    hintsByTone: hints({
      shy: { expressionHint: 'surprised' },
      sleepy: { expressionHint: 'surprised' },
      playful: { expressionHint: 'surprised', propHint: 'none' },
      curious: { expressionHint: 'surprised', propHint: 'none' },
      neutral: { expressionHint: 'surprised' },
      affectionate: { expressionHint: 'surprised', propHint: 'none' },
      flustered: { expressionHint: 'surprised' },
    }),
  },
  land: {
    kind: 'land',
    hintsByTone: hints({
      playful: { expressionHint: 'happy', propHint: 'none' },
      curious: { propHint: 'none' },
      neutral: { propHint: 'none' },
      affectionate: { propHint: 'none' },
      flustered: { propHint: 'none' },
    }),
  },
  wander: {
    kind: 'walk',
    hintsByTone: hints({}),
  },
  idle: {
    kind: 'idle_blink',
    hintsByTone: hints({}),
  },
  quiet: {
    kind: 'idle_blink',
    hintsByTone: hints({
      sleepy: { expressionHint: 'sleepy', propHint: 'pillow' },
      playful: { expressionHint: 'idle', propHint: 'none' },
      curious: { propHint: 'none' },
      affectionate: { propHint: 'none' },
      flustered: { propHint: 'none' },
    }),
  },
};

function resolvePlayKind(tone: SynthesizedEmotionalTone): AnimationIntentKind {
  return tone === 'playful' || tone === 'curious' || tone === 'neutral' ? 'walk' : 'happy_reaction';
}

function resolveQuietKind(tone: SynthesizedEmotionalTone): AnimationIntentKind {
  return tone === 'sleepy' ? 'sleep_loop' : 'idle_blink';
}

function resolveBehaviorMapping(
  intent: BehaviorIntent,
  tone: SynthesizedEmotionalTone
): BehaviorMapping {
  const mapping = BEHAVIOR_MAPPINGS[intent.kind];

  if (intent.kind === 'play') {
    return {
      ...mapping,
      kind: resolvePlayKind(tone),
    };
  }

  if (intent.kind === 'quiet') {
    return {
      ...mapping,
      kind: resolveQuietKind(tone),
    };
  }

  return mapping;
}

export function mapBehaviorIntentToAnimationIntent(
  intent: BehaviorIntent,
  tone: SynthesizedEmotionalTone
): AnimationIntent {
  const mapping = resolveBehaviorMapping(intent, tone);
  const policy = INTENT_POLICIES[mapping.kind];
  const toneHints = DEFAULT_TONE_HINTS[tone];
  const hintOverride = mapping.hintsByTone[tone];

  return {
    kind: mapping.kind,
    category: policy.category,
    priority: intent.kind === 'drag' ? 'critical' : policy.priority,
    interrupt: policy.interrupt,
    loop: policy.loop,
    requestedBy: intent.kind,
    emotionalTone: tone,
    expressionHint: hintOverride.expressionHint ?? toneHints.expressionHint,
    propHint: hintOverride.propHint ?? toneHints.propHint,
  };
}

export function createSystemAnimationIntent(
  kind: AnimationIntentKind,
  emotionalTone: SynthesizedEmotionalTone = 'neutral',
  overrides: Partial<Omit<AnimationIntent, 'kind' | 'requestedBy' | 'emotionalTone'>> = {}
): AnimationIntent {
  const policy = INTENT_POLICIES[kind];
  const toneHints = DEFAULT_TONE_HINTS[emotionalTone];

  return {
    kind,
    category: overrides.category ?? policy.category,
    priority: overrides.priority ?? policy.priority,
    interrupt: overrides.interrupt ?? policy.interrupt,
    loop: overrides.loop ?? policy.loop,
    requestedBy: 'system',
    emotionalTone,
    expressionHint: overrides.expressionHint ?? toneHints.expressionHint,
    propHint: overrides.propHint ?? toneHints.propHint,
  };
}
