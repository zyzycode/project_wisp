/**
 * Domain Model: Character Autonomous Behavior
 * Pure domain logic for autonomous decision making, random wander target generation,
 * movement interpolation, and idle activity cycles.
 */

import type { Point2D, RectBounds, Size2D } from '../models/position';
import { clampPositionToBounds } from '../models/position';

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

  const calculatedDuration = (actualDistance / config.wanderSpeedPxPerSec) * 1000;
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
 * Decides the next autonomous action based on current state and probabilities.
 */
export function decideNextAutonomousAction(
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  randomVal: number = Math.random()
): AutonomousActionType {
  if (randomVal < config.napProbability) {
    return 'take_nap';
  }
  if (randomVal < 0.75) {
    return 'wander';
  }
  if (randomVal < 0.9) {
    return 'stretch';
  }
  return 'idle_look_around';
}
