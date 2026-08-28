import { describe, it, expect } from 'vitest';
import {
  calculateNextWanderTarget,
  interpolatePosition,
  decideNextAutonomousAction,
  decideNextAutonomousBehaviorIntent,
  DEFAULT_BEHAVIOR_CONFIG,
} from '../../src/domain/behavior/autonomous-behavior';
import { selectIdleMicroMotion } from '../../src/domain/behavior/idle-variety';
import type { Needs, SynthesizedEmotionalTone } from '../../src/domain/character';
import type { RectBounds, Point2D } from '../../src/domain/models/position';

function needs(overrides: Partial<Needs> = {}): Needs {
  return {
    energy: 70,
    attention: 20,
    play: 20,
    comfort: 20,
    ...overrides,
  };
}

describe('Domain: Autonomous Behavior', () => {
  const bounds: RectBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  const petSize = { width: 100, height: 100 };

  it('calculates wander targets within screen bounds', () => {
    const start: Point2D = { x: 1000, y: 500 };
    const target = calculateNextWanderTarget(start, bounds, petSize);

    expect(target.target.x).toBeGreaterThanOrEqual(0);
    expect(target.target.x).toBeLessThanOrEqual(1820);
    expect(target.target.y).toBeGreaterThanOrEqual(0);
    expect(target.target.y).toBeLessThanOrEqual(980);
    expect(target.durationMs).toBeGreaterThanOrEqual(DEFAULT_BEHAVIOR_CONFIG.minWanderDurationMs);
    expect(target.durationMs).toBeLessThanOrEqual(DEFAULT_BEHAVIOR_CONFIG.maxWanderDurationMs);
  });

  it('handles wander calculations at screen corners and edges without exceeding bounds', () => {
    // Top-left corner
    const topLeft: Point2D = { x: 0, y: 0 };
    const targetTL = calculateNextWanderTarget(topLeft, bounds, petSize, DEFAULT_BEHAVIOR_CONFIG, Math.PI, 1);
    expect(targetTL.target.x).toBeGreaterThanOrEqual(0);
    expect(targetTL.target.y).toBeGreaterThanOrEqual(0);

    // Bottom-right corner
    const bottomRight: Point2D = { x: 1820, y: 980 };
    const targetBR = calculateNextWanderTarget(bottomRight, bounds, petSize, DEFAULT_BEHAVIOR_CONFIG, 0, 1);
    expect(targetBR.target.x).toBeLessThanOrEqual(1820);
    expect(targetBR.target.y).toBeLessThanOrEqual(980);
  });

  it('smoothly interpolates position using easing', () => {
    const start: Point2D = { x: 100, y: 100 };
    const end: Point2D = { x: 200, y: 200 };

    expect(interpolatePosition(start, end, 0)).toEqual({ x: 100, y: 100 });
    expect(interpolatePosition(start, end, 1)).toEqual({ x: 200, y: 200 });
    expect(interpolatePosition(start, end, 0.5)).toEqual({ x: 150, y: 150 });
  });

  it('decides autonomous actions based on probability thresholds', () => {
    // napProbability = 0.15
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.05)).toBe('take_nap');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.40)).toBe('wander');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.80)).toBe('stretch');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.95)).toBe('idle_look_around');
  });

  it('initiates vital sleep at energy and comfort boundaries', () => {
    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ energy: 20 }),
        tone: 'neutral',
        idleElapsedMs: 0,
      })
    ).toMatchObject({
      kind: 'sleep',
      source: 'timer',
      priority: 'high',
      moodHint: 'sleepy',
      reason: 'vital_sleep',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ comfort: 80 }),
        tone: 'playful',
        idleElapsedMs: 0,
      })
    ).toMatchObject({
      kind: 'sleep',
      priority: 'high',
      moodHint: 'sleepy',
      reason: 'vital_sleep',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ energy: 21, comfort: 79 }),
        tone: 'neutral',
        idleElapsedMs: 0,
      })
    ).toBeNull();
  });

  it('wakes from sleep_loop on attention deficit or restored energy boundaries', () => {
    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ attention: 90, energy: 60 }),
        tone: 'shy',
        currentAnimation: 'sleep_loop',
      })
    ).toMatchObject({
      kind: 'wake',
      source: 'timer',
      priority: 'high',
      moodHint: 'shy',
      reason: 'vital_wake',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ attention: 20, energy: 80 }),
        tone: 'sleepy',
        currentAnimation: 'sleep_loop',
      })
    ).toMatchObject({
      kind: 'wake',
      priority: 'high',
      reason: 'vital_wake',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs({ attention: 89, energy: 79 }),
        tone: 'sleepy',
        currentAnimation: 'sleep_loop',
        randomVal: 0.4,
      })
    ).toBeNull();
  });

  it('blocks background idle and wander timers while sleep_loop is active', () => {
    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'playful',
        currentAnimation: 'sleep_loop',
        idleElapsedMs: 60_000,
        randomVal: 0.4,
      })
    ).toBeNull();

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'curious',
        currentAnimation: 'sleep_loop',
        idleElapsedMs: 60_000,
        randomVal: 0.95,
      })
    ).toBeNull();
  });

  it('creates autonomous BehaviorIntent decisions after idle pauses', () => {
    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'neutral',
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs,
        randomVal: 0.4,
      })
    ).toMatchObject({
      kind: 'wander',
      source: 'timer',
      priority: 'normal',
      moodHint: 'neutral',
      reason: 'autonomous_wander',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'playful',
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs,
        randomVal: 0.8,
      })
    ).toMatchObject({
      kind: 'play',
      source: 'timer',
      priority: 'normal',
      moodHint: 'happy',
      reason: 'autonomous_stretch',
    });

    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'curious',
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs - 1,
        randomVal: 0.4,
      })
    ).toBeNull();
  });

  it('generates tone-aware idle micro-motions after pauses', () => {
    const expectations: Record<SynthesizedEmotionalTone, {
      readonly kind: string;
      readonly expressionHint: string;
      readonly propHint: string;
    }> = {
      shy: { kind: 'shy_glance', expressionHint: 'blush', propHint: 'none' },
      sleepy: { kind: 'sleepy_nod', expressionHint: 'sleepy', propHint: 'none' },
      playful: { kind: 'playful_wink', expressionHint: 'winking', propHint: 'sparkle' },
      curious: { kind: 'curious_head_tilt', expressionHint: 'curious', propHint: 'question' },
      neutral: { kind: 'calm_blink', expressionHint: 'idle', propHint: 'none' },
      affectionate: { kind: 'warm_smile', expressionHint: 'happy', propHint: 'heart' },
      flustered: { kind: 'flustered_fidget', expressionHint: 'blush', propHint: 'heart' },
    };

    for (const [tone, expected] of Object.entries(expectations) as Array<
      [SynthesizedEmotionalTone, (typeof expectations)[SynthesizedEmotionalTone]]
    >) {
      expect(selectIdleMicroMotion(tone, 10_000, 0)).toMatchObject({
        tone,
        ...expected,
      });
    }

    expect(selectIdleMicroMotion('curious', 1000, 0)).toBeNull();
  });

  it('uses idle micro-motion reason for low-priority idle intents', () => {
    expect(
      decideNextAutonomousBehaviorIntent({
        needs: needs(),
        tone: 'curious',
        idleElapsedMs: 10_000,
        randomVal: 0.95,
      })
    ).toMatchObject({
      kind: 'idle',
      priority: 'low',
      moodHint: 'curious',
      reason: 'idle_micro_motion:question_peek',
    });
  });
});
