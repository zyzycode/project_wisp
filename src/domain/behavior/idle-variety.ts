import type { AnimationExpressionHint, AnimationPropHint } from '../animation/animation-intent';
import type { SynthesizedEmotionalTone } from '../character';

export type IdleMicroMotionKind =
  | 'shy_glance'
  | 'bashful_shift'
  | 'sleepy_nod'
  | 'slow_blink'
  | 'playful_wink'
  | 'sparkle_bounce'
  | 'curious_head_tilt'
  | 'question_peek'
  | 'calm_blink'
  | 'soft_breathe'
  | 'warm_smile'
  | 'heart_glance'
  | 'flustered_fidget'
  | 'blush_hide';

export interface IdleMicroMotion {
  kind: IdleMicroMotionKind;
  tone: SynthesizedEmotionalTone;
  expressionHint: AnimationExpressionHint;
  propHint: AnimationPropHint;
  minPauseMs: number;
  behaviorReason: string;
}

export interface IdleVarietyConfig {
  minMicroMotionPauseMs: number;
  longIdlePauseMs: number;
}

export const DEFAULT_IDLE_VARIETY_CONFIG: IdleVarietyConfig = {
  minMicroMotionPauseMs: 2500,
  longIdlePauseMs: 9000,
};

const IDLE_MICRO_MOTIONS: Record<SynthesizedEmotionalTone, readonly IdleMicroMotion[]> = {
  shy: [
    {
      kind: 'shy_glance',
      tone: 'shy',
      expressionHint: 'blush',
      propHint: 'none',
      minPauseMs: 3000,
      behaviorReason: 'idle_micro_motion:shy_glance',
    },
    {
      kind: 'bashful_shift',
      tone: 'shy',
      expressionHint: 'blush',
      propHint: 'none',
      minPauseMs: 4500,
      behaviorReason: 'idle_micro_motion:bashful_shift',
    },
  ],
  sleepy: [
    {
      kind: 'sleepy_nod',
      tone: 'sleepy',
      expressionHint: 'sleepy',
      propHint: 'none',
      minPauseMs: 3500,
      behaviorReason: 'idle_micro_motion:sleepy_nod',
    },
    {
      kind: 'slow_blink',
      tone: 'sleepy',
      expressionHint: 'sleepy',
      propHint: 'none',
      minPauseMs: 3000,
      behaviorReason: 'idle_micro_motion:slow_blink',
    },
  ],
  playful: [
    {
      kind: 'playful_wink',
      tone: 'playful',
      expressionHint: 'winking',
      propHint: 'sparkle',
      minPauseMs: 2500,
      behaviorReason: 'idle_micro_motion:playful_wink',
    },
    {
      kind: 'sparkle_bounce',
      tone: 'playful',
      expressionHint: 'winking',
      propHint: 'sparkle',
      minPauseMs: 4000,
      behaviorReason: 'idle_micro_motion:sparkle_bounce',
    },
  ],
  curious: [
    {
      kind: 'curious_head_tilt',
      tone: 'curious',
      expressionHint: 'curious',
      propHint: 'question',
      minPauseMs: 2500,
      behaviorReason: 'idle_micro_motion:curious_head_tilt',
    },
    {
      kind: 'question_peek',
      tone: 'curious',
      expressionHint: 'curious',
      propHint: 'question',
      minPauseMs: 4200,
      behaviorReason: 'idle_micro_motion:question_peek',
    },
  ],
  neutral: [
    {
      kind: 'calm_blink',
      tone: 'neutral',
      expressionHint: 'idle',
      propHint: 'none',
      minPauseMs: 2500,
      behaviorReason: 'idle_micro_motion:calm_blink',
    },
    {
      kind: 'soft_breathe',
      tone: 'neutral',
      expressionHint: 'idle',
      propHint: 'none',
      minPauseMs: 5000,
      behaviorReason: 'idle_micro_motion:soft_breathe',
    },
  ],
  affectionate: [
    {
      kind: 'warm_smile',
      tone: 'affectionate',
      expressionHint: 'happy',
      propHint: 'heart',
      minPauseMs: 3500,
      behaviorReason: 'idle_micro_motion:warm_smile',
    },
    {
      kind: 'heart_glance',
      tone: 'affectionate',
      expressionHint: 'happy',
      propHint: 'heart',
      minPauseMs: 5500,
      behaviorReason: 'idle_micro_motion:heart_glance',
    },
  ],
  flustered: [
    {
      kind: 'flustered_fidget',
      tone: 'flustered',
      expressionHint: 'blush',
      propHint: 'heart',
      minPauseMs: 3000,
      behaviorReason: 'idle_micro_motion:flustered_fidget',
    },
    {
      kind: 'blush_hide',
      tone: 'flustered',
      expressionHint: 'blush',
      propHint: 'heart',
      minPauseMs: 5000,
      behaviorReason: 'idle_micro_motion:blush_hide',
    },
  ],
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function selectIdleMicroMotion(
  tone: SynthesizedEmotionalTone,
  idleElapsedMs: number,
  randomVal = 0,
  config: IdleVarietyConfig = DEFAULT_IDLE_VARIETY_CONFIG
): IdleMicroMotion | null {
  if (idleElapsedMs < config.minMicroMotionPauseMs) {
    return null;
  }

  const options = IDLE_MICRO_MOTIONS[tone];
  const index = Math.min(options.length - 1, Math.floor(clampUnit(randomVal) * options.length));
  const selected = options[index];

  if (selected === undefined) {
    return null;
  }

  const requiredPauseMs = idleElapsedMs >= config.longIdlePauseMs ? config.minMicroMotionPauseMs : selected.minPauseMs;

  if (idleElapsedMs < requiredPauseMs) {
    return null;
  }

  return { ...selected };
}
