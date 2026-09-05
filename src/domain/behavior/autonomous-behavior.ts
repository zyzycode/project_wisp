/**
 * Autonomous Behavior Domain Engine
 * Pure Character Engine policy for the AUTO-I01 idle/wander/sleep parity slice.
 */

import type { Point2D, RectBounds } from '../models/position';
import { calculateRootCollisionRange, type CollisionInsets } from './motion-engine';
import type { SynthesizedEmotionalTone } from '../character';
import type { Needs } from '../character';
import type { BehaviorIntent, BehaviorIntentMoodHint } from './behavior-intent';
import { selectIdleMicroMotion, type IdleVarietyConfig, DEFAULT_IDLE_VARIETY_CONFIG } from './idle-variety';

export type AutonomousActionType = 'idle_look_around' | 'wander' | 'take_nap';

export interface IPrng {
  next(): number;
}

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
  maxWanderDurationMs: 7000,
  wanderSpeedPxPerSec: 90,
  napProbability: 0.15,
  maxWanderDistancePx: 500,
};

export interface WanderTarget {
  target: Point2D;
  durationMs: number;
}

export interface AutonomousDecisionContext {
  readonly decisionSequence: number;
  readonly opportunityAtMs: number;
  readonly tone: SynthesizedEmotionalTone;
  readonly idleElapsedMs?: number;
}

export type AutonomousCandidate = BehaviorIntent & {
  readonly kind: 'idle' | 'wander' | 'sleep';
};

export interface AutonomousIntentConfig {
  behavior: BehaviorConfig;
  idleVariety: IdleVarietyConfig;
}

export const DEFAULT_AUTONOMOUS_INTENT_CONFIG: AutonomousIntentConfig = {
  behavior: DEFAULT_BEHAVIOR_CONFIG,
  idleVariety: DEFAULT_IDLE_VARIETY_CONFIG,
};

/**
 * Calculates a valid wander target within screen boundaries and distance limits.
 * For a grounded walking character, movement is strictly horizontal (left/right along the X-axis)
 * to maintain constant ground elevation (Y).
 * Automatically detects screen edges and steers away from obstacles so the pet never walks in place.
 */
export function calculateNextWanderTarget(
  currentPos: Point2D,
  screenBounds: RectBounds,
  prng: IPrng,
  collisionInsets: CollisionInsets,
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG
): WanderTarget {
  const randomAngle = nextRandom(prng) < 0.5 ? 0 : Math.PI;
  const randomDistanceFactor = 0.5 + nextRandom(prng) * 0.5;
  let range;
  try {
    range = calculateRootCollisionRange(
      { id: 'wander-planning', ...screenBounds },
      collisionInsets
    );
  } catch {
    return { target: { ...currentPos }, durationMs: 0 };
  }
  const { minX, maxX, maxY } = range;

  const roomRight = Math.max(0, maxX - currentPos.x);
  const roomLeft = Math.max(0, currentPos.x - minX);

  let directionX = Math.cos(randomAngle) >= 0 ? 1 : -1;

  // If chosen direction is blocked by screen boundary, turn around towards open space
  if (directionX > 0 && roomRight < 60 && roomLeft >= 60) {
    directionX = -1;
  } else if (directionX < 0 && roomLeft < 60 && roomRight >= 60) {
    directionX = 1;
  }

  const availableRoom = directionX > 0 ? roomRight : roomLeft;
  const desiredDistance = config.maxWanderDistancePx * randomDistanceFactor;
  const actualDistance = Math.min(availableRoom, desiredDistance);

  // If completely trapped with no room to step
  if (actualDistance < 20) {
    return {
      target: {
        x: Math.min(maxX, Math.max(minX, currentPos.x)),
        y: maxY,
      },
      durationMs: 0,
    };
  }

  const rawTargetX = currentPos.x + directionX * actualDistance;
  const clampedTarget = {
    x: Math.min(maxX, Math.max(minX, rawTargetX)),
    y: maxY,
  };

  const finalDeltaX = Math.abs(clampedTarget.x - currentPos.x);
  const calculatedDuration = (finalDeltaX / Math.max(1, config.wanderSpeedPxPerSec)) * 1000;
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
 * Selects one action from the fixed AUTO-I01 parity distribution.
 */
export function decideNextAutonomousAction(
  prng: IPrng,
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG,
  exploreChance = 0.7
): AutonomousActionType {
  const randomVal = nextRandom(prng);
  const napProb = Math.max(0, Math.min(1, config.napProbability));
  const remaining = 1 - napProb;
  const wanderThreshold = napProb + remaining * Math.max(0, Math.min(1, exploreChance));

  if (randomVal < napProb) {
    return 'take_nap';
  }
  if (randomVal < wanderThreshold) {
    return 'wander';
  }
  return 'idle_look_around';
}

function unitNeed(value: number | undefined): number {
  return Math.max(0, Math.min(1, (value ?? 0) / 100));
}

/** State-aware Explore likelihood; recent input lowers it and prolonged quiet raises it. */
export function calculateExploreChance(
  needs: Readonly<Needs>,
  idleElapsedMs: number,
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG
): number {
  const prolongedIdleMs = Math.max(config.minIdleDurationMs + 1, config.maxIdleDurationMs * 6);
  const inactivity = Math.max(0, Math.min(
    1,
    (idleElapsedMs - config.minIdleDurationMs) /
      (prolongedIdleMs - config.minIdleDurationMs)
  ));
  const stateDrive = Math.min(
    1,
    unitNeed(needs.boredom) * 0.6 + unitNeed(needs.play) * 0.25 + unitNeed(needs.energy) * 0.15
  );
  return Math.max(0.15, Math.min(0.92, 0.2 + inactivity * 0.45 + stateDrive * 0.35));
}

/** Converts one cadence draw into a bounded state/inactivity-aware delay. */
export function calculateAutonomyOpportunityDelayMs(
  randomUnit: number,
  needs: Readonly<Needs>,
  idleElapsedMs: number,
  config: BehaviorConfig = DEFAULT_BEHAVIOR_CONFIG
): number {
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) {
    throw new RangeError('randomUnit must be finite and in [0, 1)');
  }
  const rangeMs = Math.max(0, config.maxIdleDurationMs - config.minIdleDurationMs);
  if (rangeMs === 0) return Math.max(0, config.minIdleDurationMs);
  const baseDelayMs = config.minIdleDurationMs + randomUnit * rangeMs;
  const prolongedIdleMs = Math.max(config.minIdleDurationMs + 1, config.maxIdleDurationMs * 6);
  const inactivity = Math.max(0, Math.min(1, idleElapsedMs / prolongedIdleMs));
  const drive = calculateExploreChance(needs, idleElapsedMs, config);
  const multiplier = 1.3 - inactivity * 0.55 - drive * 0.25;
  return Math.max(
    config.minIdleDurationMs,
    Math.min(config.maxIdleDurationMs, Math.round(baseDelayMs * multiplier))
  );
}

function nextRandom(prng: IPrng): number {
  const value = prng.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('IPrng.next() must return a finite value in [0, 1)');
  }
  return value;
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

/** Pure policy selection over Application-normalized candidates. */
export function resolveAutonomousBehaviorIntent(
  context: AutonomousDecisionContext,
  candidates: readonly AutonomousCandidate[],
  prng: IPrng,
  config: AutonomousIntentConfig = DEFAULT_AUTONOMOUS_INTENT_CONFIG,
  needs?: Readonly<Needs>
): BehaviorIntent | null {
  const idleElapsedMs = context.idleElapsedMs ?? config.behavior.minIdleDurationMs;

  if (idleElapsedMs < config.behavior.minIdleDurationMs) {
    return null;
  }

  const action = decideNextAutonomousAction(
    prng,
    config.behavior,
    needs === undefined ? 0.7 : calculateExploreChance(needs, idleElapsedMs, config.behavior)
  );

  switch (action) {
    case 'take_nap':
      return candidates.find((candidate) => candidate.kind === 'sleep') ?? null;
    case 'wander':
      return candidates.find((candidate) => candidate.kind === 'wander') ?? null;
    case 'idle_look_around': {
      const idleCandidate = candidates.find((candidate) => candidate.kind === 'idle');
      if (idleCandidate === undefined) return null;
      const microMotion = selectIdleMicroMotion(
        context.tone,
        idleElapsedMs,
        nextRandom(prng),
        config.idleVariety
      );

      return {
        ...idleCandidate,
        moodHint: toneToMoodHint(context.tone),
        reason: microMotion?.behaviorReason ?? idleCandidate.reason,
      };
    }
  }
}
