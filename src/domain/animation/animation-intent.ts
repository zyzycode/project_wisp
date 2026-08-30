import type { SynthesizedEmotionalTone } from '../character/types';
import type { BehaviorIntent, BehaviorIntentKind } from '../behavior/behavior-intent';

export type CoreAnimationIntentKind =
  | 'idle_blink'
  | 'walk'
  | 'settle'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'happy_reaction'
  | 'confused_reaction'
  | 'thinking_loop'
  | 'talking'
  | 'bored'
  | 'wave'
  | 'celebrate'
  | 'spook'
  | 'dragged'
  | 'land';

export type LocomotionAnimationIntentKind =
  | 'sit'
  | 'stand_up'
  | 'lie_down'
  | 'get_up'
  | 'run'
  | 'jump'
  | 'fall'
  | 'crawl'
  | 'climb_wall'
  | 'hang_ceiling'
  | 'crash_landing';

export type AnimationIntentKind = CoreAnimationIntentKind | LocomotionAnimationIntentKind;
export type AnyAnimationIntentKind = AnimationIntentKind;

export type AnimationCategory =
  | 'idle'
  | 'movement'
  | 'reaction'
  | 'dialogue'
  | 'sleep'
  | 'gesture'
  | 'transition'
  | 'physics';

export type AnimationIntentCategory = AnimationCategory;

export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';

export type AnimationInterruptPolicy = 'yes' | 'no' | 'limited';

export type AnimationLoopMode = 'none' | 'until_replaced' | 'bounded';

export type AnimationExpressionHint =
  | 'idle'
  | 'blush'
  | 'happy'
  | 'winking'
  | 'pout'
  | 'curious'
  | 'thinking'
  | 'sleepy'
  | 'surprised'
  | 'shocked'
  | 'sad'
  | 'angry'
  | 'talking'
  | 'flying'
  | 'gaze'
  | 'dizzy'
  | 'flirty';

export type AnimationGazeDirection = 'left' | 'right' | 'up' | 'down';

export type AnimationPropHint =
  | 'pillow'
  | 'heart'
  | 'question'
  | 'sparkle'
  | 'none';

export interface AnimationIntent<TKind extends string = CoreAnimationIntentKind> {
  readonly kind: TKind;
  readonly category: AnimationCategory;
  readonly priority: AnimationPriority;
  readonly interrupt: AnimationInterruptPolicy;
  readonly loop: AnimationLoopMode;
  readonly requestedBy: string;
  readonly emotionalTone: SynthesizedEmotionalTone;
  readonly expressionHint?: AnimationExpressionHint;
  /** Selected frame of the discrete `face_gaze` overlay, when requested. */
  readonly gazeDirection?: AnimationGazeDirection;
  readonly propHint?: AnimationPropHint;
}

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
  idle_blink: { category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced' },
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
  wave: { category: 'reaction', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  celebrate: { category: 'reaction', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  bored: { category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced' },
  sit: { category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced' },
  stand_up: { category: 'transition', priority: 'normal', interrupt: 'yes', loop: 'none' },
  lie_down: { category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced' },
  get_up: { category: 'transition', priority: 'normal', interrupt: 'yes', loop: 'none' },
  run: { category: 'movement', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  jump: { category: 'movement', priority: 'normal', interrupt: 'limited', loop: 'none' },
  fall: { category: 'movement', priority: 'normal', interrupt: 'no', loop: 'until_replaced' },
  crawl: { category: 'movement', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  climb_wall: { category: 'movement', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  hang_ceiling: { category: 'movement', priority: 'normal', interrupt: 'yes', loop: 'until_replaced' },
  crash_landing: { category: 'physics', priority: 'critical', interrupt: 'no', loop: 'none' },
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
      curious: {},
      neutral: { expressionHint: 'surprised', propHint: 'question' },
      affectionate: { expressionHint: 'pout' },
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
  sit: {
    kind: 'sit',
    hintsByTone: hints({}),
  },
  stand_up: {
    kind: 'stand_up',
    hintsByTone: hints({
      playful: { expressionHint: 'happy' },
    }),
  },
  lie_down: {
    kind: 'lie_down',
    hintsByTone: hints({}),
  },
  get_up: {
    kind: 'get_up',
    hintsByTone: hints({}),
  },
  run: {
    kind: 'run',
    hintsByTone: hints({
      neutral: { expressionHint: 'happy' },
    }),
  },
  jump: {
    kind: 'jump',
    hintsByTone: hints({
      neutral: { expressionHint: 'happy' },
    }),
  },
  fall: {
    kind: 'fall',
    hintsByTone: hints({
      shy: { expressionHint: 'surprised', propHint: 'none' },
      sleepy: { expressionHint: 'surprised', propHint: 'none' },
      playful: { expressionHint: 'surprised', propHint: 'sparkle' },
      curious: { expressionHint: 'surprised', propHint: 'question' },
      neutral: { expressionHint: 'surprised', propHint: 'none' },
      affectionate: { expressionHint: 'surprised', propHint: 'heart' },
      flustered: { expressionHint: 'surprised', propHint: 'heart' },
    }),
  },
  crawl: {
    kind: 'crawl',
    hintsByTone: hints({
      neutral: { expressionHint: 'curious' },
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
  const mapping = BEHAVIOR_MAPPINGS[intent.kind] ?? {
    kind: 'idle_blink',
    hintsByTone: hints({}),
  };

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
): AnimationIntent<any> {
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
): AnimationIntent<any> {
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
    ...(overrides.gazeDirection === undefined ? {} : { gazeDirection: overrides.gazeDirection }),
    propHint: overrides.propHint ?? toneHints.propHint,
  };
}
