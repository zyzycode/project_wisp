import { describe, it, expect } from 'vitest';
import {
  calculateNextWanderTarget,
  interpolatePosition,
  decideNextAutonomousAction,
  decideNextAutonomousBehaviorIntent,
  DEFAULT_BEHAVIOR_CONFIG,
} from '../../src/domain/behavior/autonomous-behavior';
import { selectIdleMicroMotion } from '../../src/domain/behavior/idle-variety';
import type { Needs } from '../../src/domain/character';
import type { RectBounds, Point2D } from '../../src/domain/models/position';

function needs(overrides: Partial<Needs> = {}): Needs {
  return {
    energy: 70,
    attention: 20,
    play: 20,
    comfort: 20,
    boredom: 20,
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

  it('responds to high boredom with active locomotion actions', () => {
    const boredNeeds = needs({ boredom: 80, energy: 60 });
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.2, boredNeeds)).toBe('run');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.5, boredNeeds)).toBe('jump');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.8, boredNeeds)).toBe('wander');

    const intent = decideNextAutonomousBehaviorIntent({
      needs: boredNeeds,
      tone: 'playful',
      randomVal: 0.2,
      idleElapsedMs: 5000,
    });
    expect(intent).toMatchObject({
      kind: 'run',
      source: 'timer',
      priority: 'normal',
      reason: 'autonomous_run',
    });
  });

  it('responds to tired energy with resting locomotion postures', () => {
    const tiredNeeds = needs({ energy: 30 });
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.3, tiredNeeds)).toBe('sit');
    expect(decideNextAutonomousAction(DEFAULT_BEHAVIOR_CONFIG, 0.7, tiredNeeds)).toBe('lie_down');

    const sitIntent = decideNextAutonomousBehaviorIntent({
      needs: tiredNeeds,
      tone: 'sleepy',
      randomVal: 0.3,
      idleElapsedMs: 5000,
    });
    expect(sitIntent).toMatchObject({
      kind: 'sit',
      source: 'timer',
      priority: 'low',
      reason: 'autonomous_sit',
    });
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
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs,
        randomVal: 0.95,
      })
    ).toMatchObject({
      kind: 'idle',
      source: 'timer',
      priority: 'low',
      moodHint: 'curious',
    });
  });

  it('selects idle micro motions with tone and probability bias', () => {
    const motion = selectIdleMicroMotion('shy', 4500, 0.1);
    expect(motion).toBeDefined();
    expect(motion?.kind).toBeDefined();
    expect(motion?.minPauseMs).toBeGreaterThan(0);
  });
});
