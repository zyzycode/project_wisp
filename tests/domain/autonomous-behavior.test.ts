import { describe, it, expect } from 'vitest';
import {
  calculateNextWanderTarget,
  interpolatePosition,
  decideNextAutonomousAction,
  DEFAULT_BEHAVIOR_CONFIG,
} from '../../src/domain/behavior/autonomous-behavior';
import type { RectBounds, Point2D } from '../../src/domain/models/position';

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
});
