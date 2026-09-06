import type { SynthesizedEmotionalTone } from '../character';
import type { Needs } from '../character/needs';
import type { ActivityDefinition, AnimationIntentTemplate } from './activity-runner';
import type { CursorProximitySignal, GazeDirection } from './gaze-engine';

export type CursorDistanceZone = 'contact' | 'near' | 'ambient' | 'far';
export type ObserveCursorReaction =
  | 'gaze_only'
  | 'head_tilt'
  | 'point'
  | 'reach'
  | 'greeting';

export interface CursorObserveConstraints {
  readonly contactRadiusWorldPx: number;
  readonly nearRadiusWorldPx: number;
  readonly ambientRadiusWorldPx: number;
  readonly signalMaxAgeMs: number;
}

export interface CursorObserveInput {
  readonly nowMs: number;
  readonly signal?: CursorProximitySignal;
  readonly needs: Readonly<Needs>;
  readonly tone: SynthesizedEmotionalTone;
  readonly friendship: number;
  readonly noticeRandomUnit: number;
}

export interface CursorObserveUpdate {
  readonly noticed: boolean;
  readonly zone?: CursorDistanceZone;
  readonly noticeChance: number;
}

export const DEFAULT_CURSOR_OBSERVE_CONSTRAINTS: CursorObserveConstraints = Object.freeze({
  contactRadiusWorldPx: 64,
  nearRadiusWorldPx: 160,
  ambientRadiusWorldPx: 360,
  signalMaxAgeMs: 300,
});

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function requireRandomUnit(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`${name} must be finite and in [0, 1)`);
  }
}

function isFresh(signal: CursorProximitySignal, nowMs: number, maxAgeMs: number): boolean {
  const ageMs = nowMs - signal.cursor.capturedAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

export function cursorDistanceZone(
  distanceWorldPx: number,
  constraints: CursorObserveConstraints = DEFAULT_CURSOR_OBSERVE_CONSTRAINTS
): CursorDistanceZone {
  if (distanceWorldPx <= constraints.contactRadiusWorldPx) return 'contact';
  if (distanceWorldPx <= constraints.nearRadiusWorldPx) return 'near';
  if (distanceWorldPx <= constraints.ambientRadiusWorldPx) return 'ambient';
  return 'far';
}

export function calculateCursorNoticeChance(
  zone: CursorDistanceZone,
  input: Pick<CursorObserveInput, 'needs' | 'tone' | 'friendship' | 'nowMs'>,
): number {
  const base = zone === 'contact' ? 0.72 : zone === 'near' ? 0.52 : zone === 'ambient' ? 0.16 : 0.02;
  const stateBoost =
    (input.tone === 'curious' ? 0.16 : 0) +
    (input.tone === 'playful' ? 0.14 : 0) +
    (input.friendship >= 700 ? 0.12 : 0) +
    clampUnit((input.needs.boredom ?? 0) / 100) * 0.08 +
    clampUnit(input.needs.play / 100) * 0.08;
  const fatiguePenalty = input.needs.energy <= 35 ? 0.3 : 0;
  return clampUnit(base + stateBoost - fatiguePenalty);
}

export function resolveCursorObserve(
  input: CursorObserveInput,
  constraints: CursorObserveConstraints = DEFAULT_CURSOR_OBSERVE_CONSTRAINTS
): CursorObserveUpdate {
  requireRandomUnit(input.noticeRandomUnit, 'noticeRandomUnit');
  const signal = input.signal;
  if (
    signal === undefined ||
    !isFresh(signal, input.nowMs, constraints.signalMaxAgeMs)
  ) {
    return { noticed: false, noticeChance: 0 };
  }

  const zone = cursorDistanceZone(signal.distanceToRootWorldPx, constraints);
  const noticeChance = calculateCursorNoticeChance(zone, input);
  return {
    noticed: input.noticeRandomUnit < noticeChance,
    zone,
    noticeChance,
  };
}

function visualFor(
  reaction: ObserveCursorReaction,
  gazeDirection: GazeDirection
): AnimationIntentTemplate {
  if (reaction === 'gaze_only') {
    return {
      kind: 'idle_blink',
      expressionHint: 'gaze',
      gazeDirection,
      propHint: 'none',
      loop: 'bounded',
    };
  }
  if (reaction === 'head_tilt') {
    return { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none', loop: 'bounded' };
  }
  if (reaction === 'point') {
    return { kind: 'thinking_loop', expressionHint: 'winking', propHint: 'sparkle', loop: 'bounded' };
  }
  if (reaction === 'reach') {
    return { kind: 'wave', expressionHint: 'curious', propHint: 'none', loop: 'bounded' };
  }
  return { kind: 'wave', expressionHint: 'happy', propHint: 'heart', loop: 'bounded' };
}

/** Existing sprites are deliberate fallbacks until dedicated cursor gesture sheets exist. */
export function createCursorObserveActivity(
  reaction: ObserveCursorReaction,
  gazeDirection: GazeDirection = 'down',
  baseWeight = 1
): ActivityDefinition {
  const steps: ActivityDefinition['steps'] = Object.freeze([{
    id: 'react',
    actionId: `observe_cursor:${reaction}`,
    stage: 'looping',
    type: 'animation',
    intent: visualFor(reaction, gazeDirection),
    completion: {
      type: 'elapsed',
      durationMs: reaction === 'gaze_only' ? 900 : reaction === 'head_tilt' ? 1_400 : 1_800,
    },
  }]);
  return Object.freeze({
    id: 'observe_cursor',
    priority: 'P3_reactive',
    baseWeight,
    cooldownKey: 'observe_cursor',
    entryStepId: 'react',
    steps,
    tags: Object.freeze(['cursor', reaction]),
  });
}

export interface CursorObserveActivityContext {
  readonly zone: CursorDistanceZone;
  readonly needs: Readonly<Needs>;
  readonly tone: SynthesizedEmotionalTone;
  readonly friendship: number;
  readonly gazeDirection: GazeDirection;
}

/**
 * Builds the play-compatible Activity candidates. Behavior Brain applies the
 * shared cooldown and repetition weights before ActivityRunner starts one.
 */
export function createCursorObserveActivityCandidates(
  context: CursorObserveActivityContext
): readonly ActivityDefinition[] {
  if (context.needs.energy <= 35 || context.tone === 'sleepy') {
    return Object.freeze([createCursorObserveActivity('gaze_only', context.gazeDirection, 1)]);
  }

  const candidates: ActivityDefinition[] = [];
  if (context.friendship >= 700) {
    candidates.push(createCursorObserveActivity('greeting', context.gazeDirection, 0.14));
  } else if (context.tone === 'playful' || context.needs.play >= 70) {
    candidates.push(createCursorObserveActivity('point', context.gazeDirection, 0.12));
  } else if (context.tone === 'curious') {
    candidates.push(createCursorObserveActivity('head_tilt', context.gazeDirection, 0.24));
  }
  if (context.zone === 'contact' || context.zone === 'near') {
    candidates.push(createCursorObserveActivity(
      'reach',
      context.gazeDirection,
      context.zone === 'contact' ? 0.1 : 0.06
    ));
  }
  if (context.tone !== 'curious') {
    candidates.push(createCursorObserveActivity('head_tilt', context.gazeDirection, 0.1));
  }
  candidates.push(createCursorObserveActivity('gaze_only', context.gazeDirection, 0.72));
  return Object.freeze(candidates);
}
