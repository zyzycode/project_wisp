/**
 * Domain Model: Character Autonomous Behavior
 * Pure domain logic for autonomous decision making, random wander target generation,
 * movement interpolation, and idle activity cycles.
 */

import type { Point2D, RectBounds, Size2D } from '../models/position';
import type { AnimationIntentKind } from '../animation';
import type { Needs, SynthesizedEmotionalTone } from '../character';
import type { BehaviorIntent, BehaviorIntentMoodHint } from './behavior-intent';
import { clampPositionToBounds } from '../models/position';
import { selectIdleMicroMotion, type IdleVarietyConfig, DEFAULT_IDLE_VARIETY_CONFIG } from './idle-variety';

export type AutonomousActionType =
  | 'idle_look_around'
  | 'wander'
  | 'take_nap'
  | 'stretch';

export interface BehaviorConfig {
  minIdleDurationMs: number;
  maxIdleDurationMs: number;
  minWanderDurationMs: number;
  maxWanderDurationMs: number;
  wanderSpeedPxPerSec: number;
  napProbability: number;
  maxWanderDistancePx: number;
}

export const DEFAULT_BEHAVIOR_CONFIG: BehaviorConfig = {
  minIdleDurationMs: 4000,
  maxIdleDurationMs: 9000,
  minWanderDurationMs: 2500,
  maxWanderDurationMs: 6000,
  wanderSpeedPxPerSec: 75,
  napProbability: 0.15,
  maxWanderDistancePx: 250,
};

export interface WanderTarget {
  target: Point2D;
  durationMs: number;
}

export interface VitalAutonomousThresholds {
  sleepEnergyMax: number;
  sleepComfortMin: number;
  wakeAttentionMin: number;
  wakeEnergyMin: number;
}

export const DEFAULT_VITAL_AUTONOMOUS_THRESHOLDS: VitalAutonomousThresholds = {
  sleepEnergyMax: 20,
  sleepComfortMin: 80,
  wakeAttentionMin: 90,
  wakeEnergyMin: 80,
};

export type AutonomousAnimationStateHint =
  | AnimationIntentKind
  | 'idle'
  | 'float'
  | 'falling'
  | 'landing'
  | 'sleep'
  | 'happy'
  | 'surprised'
  | 'thinking';

export interface AutonomousDecisionContext {
  needs: Needs;
  tone: SynthesizedEmotionalTone;
  currentAnimation?: AutonomousAnimationStateHint;
  idleElapsedMs?: number;
  randomVal?: number;
}

export interface AutonomousIntentConfig {
  behavior: BehaviorConfig;
  idleVariety: IdleVarietyConfig;
  thresholds: VitalAutonomousThresholds;
}

export const DEFAULT_AUTONOMOUS_INTENT_CONFIG: AutonomousIntentConfig = {
  behavior: DEFAULT_BEHAVIOR_CONFIG,
  idleVariety: DEFAULT_IDLE_VARIETY_CONFIG,
  thresholds: DEFAULT_VITAL_AUTONOMOUS_THRESHOLDS,
};

/**
 * Calculates a valid wander target within screen boundaries and distance limits.
 */
export function calculateNextWanderTarget(
  currentPos: Point2D,
  screenBounds: RectBounds,
  petSize: Size2D = { width: 100, height: 100 },
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  randomAngle: number = Math.random() * Math.PI * 2,
  randomDistanceFactor: number = 0.5 + Math.random() * 0.5
): WanderTarget {
  const distance = config.maxWanderDistancePx * randomDistanceFactor;
  const rawTargetX = currentPos.x + Math.cos(randomAngle) * distance;
  const rawTargetY = currentPos.y + Math.sin(randomAngle) * distance;

  const clampedTarget = clampPositionToBounds(
    { x: rawTargetX, y: rawTargetY },
    petSize,
    screenBounds
  );

  const actualDeltaX = clampedTarget.x - currentPos.x;
  const actualDeltaY = clampedTarget.y - currentPos.y;
  const actualDistance = Math.hypot(actualDeltaX, actualDeltaY);

  const calculatedDuration = (actualDistance / Math.max(1, config.wanderSpeedPxPerSec)) * 1000;
  const durationMs = Math.max(
    config.minWanderDurationMs,
    Math.min(config.maxWanderDurationMs, calculatedDuration)
  );

  return {
    target: clampedTarget,
    durationMs: Math.round(durationMs),
  };
}

/**
 * Linear/smooth interpolation between current position and target.
 */
export function interpolatePosition(
  startPos: Point2D,
  targetPos: Point2D,
  progress: number // 0.0 to 1.0
): Point2D {
  const t = Math.max(0, Math.min(1, progress));
  // Ease-in-out curve
  const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

  return {
    x: Math.round(startPos.x + (targetPos.x - startPos.x) * ease),
    y: Math.round(startPos.y + (targetPos.y - startPos.y) * ease),
  };
}

/**
 * Decides the next autonomous action based on configuration probabilities.
 */
export function decideNextAutonomousAction(
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  randomVal: number = Math.random()
): AutonomousActionType {
  const napProb = Math.max(0, Math.min(1, config.napProbability));
  const remaining = 1 - napProb;
  const wanderThreshold = napProb + remaining * 0.7;
  const stretchThreshold = napProb + remaining * 0.9;

  if (randomVal < napProb) {
    return 'take_nap';
  }
  if (randomVal < wanderThreshold) {
    return 'wander';
  }
  if (randomVal < stretchThreshold) {
    return 'stretch';
  }
  return 'idle_look_around';
}

function isSleepAnimationState(currentAnimation: AutonomousAnimationStateHint | undefined): boolean {
  return currentAnimation === 'sleep_loop' || currentAnimation === 'sleep_start' || currentAnimation === 'sleep';
}

function toneToMoodHint(tone: SynthesizedEmotionalTone): BehaviorIntentMoodHint {
  switch (tone) {
    case 'playful':
      return 'happy';
    case 'flustered':
      return 'shy';
    case 'sleepy':
    case 'curious':
    case 'shy':
    case 'affectionate':
    case 'neutral':
      return tone;
  }
}

function createTimerIntent(kind: BehaviorIntent['kind'], tone: SynthesizedEmotionalTone, priority: BehaviorIntent['priority'], reason: string): BehaviorIntent {
  return {
    kind,
    source: 'timer',
    priority,
    moodHint: toneToMoodHint(tone),
    reason,
  };
}

function shouldSleep(needs: Needs, thresholds: VitalAutonomousThresholds): boolean {
  return needs.energy <= thresholds.sleepEnergyMax || needs.comfort >= thresholds.sleepComfortMin;
}

function shouldWakeFromSleep(needs: Needs, thresholds: VitalAutonomousThresholds): boolean {
  return needs.attention >= thresholds.wakeAttentionMin || needs.energy >= thresholds.wakeEnergyMin;
}

export function decideNextAutonomousBehaviorIntent(
  context: AutonomousDecisionContext,
  config: AutonomousIntentConfig = DEFAULT_AUTONOMOUS_INTENT_CONFIG
): BehaviorIntent | null {
  const sleepActive = isSleepAnimationState(context.currentAnimation);

  if (sleepActive) {
    if (shouldWakeFromSleep(context.needs, config.thresholds)) {
      return createTimerIntent('wake', context.tone, 'high', 'vital_wake');
    }

    return null;
  }

  if (shouldSleep(context.needs, config.thresholds)) {
    return createTimerIntent('sleep', 'sleepy', 'high', 'vital_sleep');
  }

  const idleElapsedMs = context.idleElapsedMs ?? config.behavior.minIdleDurationMs;

  if (idleElapsedMs < config.behavior.minIdleDurationMs) {
    return null;
  }

  const randomVal = context.randomVal ?? Math.random();
  const action = decideNextAutonomousAction(config.behavior, randomVal);

  switch (action) {
    case 'take_nap':
      return createTimerIntent('sleep', 'sleepy', 'high', 'autonomous_nap');
    case 'wander':
      return createTimerIntent('wander', context.tone, 'normal', 'autonomous_wander');
    case 'stretch':
      return createTimerIntent('play', context.tone, 'normal', 'autonomous_stretch');
    case 'idle_look_around': {
      const microMotion = selectIdleMicroMotion(
        context.tone,
        idleElapsedMs,
        randomVal,
        config.idleVariety
      );

      return createTimerIntent('idle', context.tone, 'low', microMotion?.behaviorReason ?? 'autonomous_idle');
    }
  }
}
