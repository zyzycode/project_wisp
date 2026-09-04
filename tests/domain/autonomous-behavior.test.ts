import { describe, expect, it } from 'vitest';
import {
  calculateNextWanderTarget,
  decideNextAutonomousAction,
  DEFAULT_BEHAVIOR_CONFIG,
  resolveAutonomousBehaviorIntent,
  type AutonomousCandidate,
  type IPrng,
} from '../../src/domain/behavior/autonomous-behavior';

function prng(...values: number[]): IPrng {
  let index = 0;
  return { next: () => values[index++] ?? values.at(-1) ?? 0 };
}

const candidates = Object.freeze([
  Object.freeze({ kind: 'idle', source: 'timer', priority: 'low', reason: 'autonomous_idle' }),
  Object.freeze({ kind: 'wander', source: 'timer', priority: 'normal', reason: 'autonomous_wander' }),
  Object.freeze({ kind: 'sleep', source: 'timer', priority: 'high', moodHint: 'sleepy', reason: 'autonomous_nap' }),
] satisfies AutonomousCandidate[]);

describe('Domain: Autonomous Behavior', () => {
  const bounds = { x: -300, y: 40, width: 1200, height: 800 };
  const insets = { left: 35, right: 65, top: 80, bottom: 15 };

  it('plans deterministic grounded root targets in non-zero and negative-origin bounds', () => {
    const left = calculateNextWanderTarget(
      { x: 400, y: 825 }, bounds, prng(0.9, 1 - Number.EPSILON), insets
    );
    const repeat = calculateNextWanderTarget(
      { x: 400, y: 825 }, bounds, prng(0.9, 1 - Number.EPSILON), insets
    );

    expect(left).toEqual(repeat);
    expect(left.target.x).toBeCloseTo(-100, 8);
    expect(left.target.y).toBe(825);
    expect(left.durationMs).toBeGreaterThanOrEqual(DEFAULT_BEHAVIOR_CONFIG.minWanderDurationMs);
    expect(left.durationMs).toBeLessThanOrEqual(DEFAULT_BEHAVIOR_CONFIG.maxWanderDurationMs);
  });

  it('reverses at both root edges and returns a no-op when no step fits', () => {
    const minX = bounds.x + insets.left;
    const maxX = bounds.x + bounds.width - insets.right;
    expect(calculateNextWanderTarget({ x: minX, y: 825 }, bounds, prng(0.9, 0.9), insets).target.x)
      .toBeGreaterThan(minX);
    expect(calculateNextWanderTarget({ x: maxX, y: 825 }, bounds, prng(0.1, 0.9), insets).target.x)
      .toBeLessThan(maxX);
    expect(calculateNextWanderTarget(
      { x: 5, y: 5 },
      { x: 0, y: 0, width: 10, height: 10 },
      prng(0.1, 0.5),
      { left: 6, right: 6, top: 0, bottom: 0 }
    )).toEqual({ target: { x: 5, y: 5 }, durationMs: 0 });
  });

  it('keeps the parity distribution limited to nap, wander, and idle', () => {
    expect(decideNextAutonomousAction(prng(0.05))).toBe('take_nap');
    expect(decideNextAutonomousAction(prng(0.4))).toBe('wander');
    expect(decideNextAutonomousAction(prng(0.95))).toBe('idle_look_around');
  });

  it('selects only from the ordered normalized candidates after cadence', () => {
    expect(resolveAutonomousBehaviorIntent(
      { decisionSequence: 1, opportunityAtMs: 10, tone: 'neutral', idleElapsedMs: 1 },
      candidates,
      prng(0.4)
    )).toBeNull();
    expect(resolveAutonomousBehaviorIntent(
      {
        decisionSequence: 2,
        opportunityAtMs: 20,
        tone: 'neutral',
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs,
      },
      candidates,
      prng(0.4)
    )).toMatchObject({ kind: 'wander', reason: 'autonomous_wander' });
  });

  it('rejects non-conforming randomness', () => {
    expect(() => decideNextAutonomousAction(prng(1))).toThrow(RangeError);
    expect(() => calculateNextWanderTarget({ x: 0, y: 0 }, bounds, prng(Number.NaN), insets))
      .toThrow(RangeError);
  });
});
