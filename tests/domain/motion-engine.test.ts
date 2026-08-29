import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION_CONSTRAINTS,
  MotionEngine,
  type LandingOutcome,
  type MotionConstraints,
  type MotionState,
  type ScreenBoundsDto,
} from '../../src/domain/behavior/motion-engine';

const bounds: ScreenBoundsDto = { id: 'primary', x: 0, y: 0, width: 1000, height: 800 };
const floorY = bounds.height - DEFAULT_MOTION_CONSTRAINTS.collisionInsets.bottom;

function state(overrides: Partial<MotionState> = {}): MotionState {
  return {
    phase: 'grounded',
    position: { x: 500, y: floorY },
    velocityPxPerSec: { x: 0, y: 0 },
    activeBoundsId: bounds.id,
    airborneElapsedSec: 0,
    peakGroundImpactSeverity: 0,
    ...overrides,
  };
}

function simulateLanding(initialVelocityY: number): {
  readonly state: MotionState;
  readonly outcome: LandingOutcome;
} {
  const engine = new MotionEngine();
  let current = engine.beginAirborne(state(), {
    cause: 'support_lost',
    position: { x: 500, y: floorY - 1 },
    velocityPxPerSec: { x: 0, y: initialVelocityY },
    boundsId: bounds.id,
    atMs: 0,
  }).state;

  for (let step = 0; step < 5000; step += 1) {
    const result = engine.step({
      state: current,
      stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
      bounds,
    });
    current = result.state;
    const landed = result.events.find((event) => event.type === 'landed');
    if (landed?.type === 'landed') {
      return { state: current, outcome: landed.outcome };
    }
  }

  throw new Error('motion did not settle');
}

describe('Domain: Motion Engine', () => {
  it('estimates release velocity from the bounded sliding window with weighted regression', () => {
    const engine = new MotionEngine();
    const throwVector = engine.estimateThrow(
      [
        { position: { x: -100, y: -100 }, capturedAtMs: 800 },
        { position: { x: 10, y: 20 }, capturedAtMs: 900 },
        { position: { x: 999, y: 999 }, capturedAtMs: 950 },
        { position: { x: 30, y: 30 }, capturedAtMs: 950 },
        { position: { x: 50, y: 40 }, capturedAtMs: 1000 },
      ],
      1000
    );

    expect(throwVector).toMatchObject({ sampledAtMs: 1000, sampleCount: 3, sampleSpanMs: 100 });
    expect(throwVector.vxPxPerSec).toBeCloseTo(400, 8);
    expect(throwVector.vyPxPerSec).toBeCloseTo(200, 8);
  });

  it('returns zero for an insufficient sample span and clamps excessive throw speed', () => {
    const engine = new MotionEngine();

    expect(
      engine.estimateThrow(
        [
          { position: { x: 0, y: 0 }, capturedAtMs: 990 },
          { position: { x: 10, y: 10 }, capturedAtMs: 1000 },
        ],
        1000
      )
    ).toMatchObject({ vxPxPerSec: 0, vyPxPerSec: 0, sampleCount: 2, sampleSpanMs: 10 });

    const clamped = engine.estimateThrow(
      [
        { position: { x: 0, y: 0 }, capturedAtMs: 900 },
        { position: { x: 1000, y: 0 }, capturedAtMs: 1000 },
      ],
      1000
    );
    expect(Math.hypot(clamped.vxPxPerSec, clamped.vyPxPerSec)).toBeCloseTo(
      DEFAULT_MOTION_CONSTRAINTS.throwSampling.maxThrowSpeedPxPerSec,
      8
    );
  });

  it('applies gravity, exponential air damping, and semi-implicit position integration', () => {
    const engine = new MotionEngine();
    const airborne = state({
      phase: 'airborne',
      position: { x: 500, y: 400 },
      velocityPxPerSec: { x: 100, y: -200 },
    });
    const result = engine.step({ state: airborne, stepSec: 0.1, bounds });
    const expectedVx = 100 * Math.exp(-0.35 * 0.1);
    const expectedVy = (-200 + 1800 * 0.1) * Math.exp(-0.08 * 0.1);

    expect(result.state.velocityPxPerSec.x).toBeCloseTo(expectedVx, 8);
    expect(result.state.velocityPxPerSec.y).toBeCloseTo(expectedVy, 8);
    expect(result.state.position.x).toBeCloseTo(500 + expectedVx * 0.1, 8);
    expect(result.state.position.y).toBeCloseTo(400 + expectedVy * 0.1, 8);
    expect(result.events).toEqual([]);
  });

  it('clamps wall penetration and reflects only outward velocity with restitution', () => {
    const engine = new MotionEngine();
    const result = engine.step({
      state: state({
        phase: 'airborne',
        position: { x: DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left + 1, y: 400 },
        velocityPxPerSec: { x: -500, y: 0 },
      }),
      stepSec: 0.1,
      bounds,
    });

    expect(result.state.position.x).toBe(DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left);
    expect(result.state.velocityPxPerSec.x).toBeGreaterThan(0);
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'collision', side: 'left' })
    );
  });

  it.each([
    ['soft_landing', 100],
    ['stumble', 600],
    ['crash_landing', 1200],
  ] as const)('classifies %s from peak floor impact severity', (expectedOutcome, initialVelocityY) => {
    const result = simulateLanding(initialVelocityY);

    expect(result.outcome).toBe(expectedOutcome);
    expect(result.state.phase).toBe('grounded');
    expect(result.state.position.y).toBe(floorY);
    expect(result.state.velocityPxPerSec).toEqual({ x: 0, y: 0 });
  });

  it('emits release and airborne events while resetting flight counters', () => {
    const engine = new MotionEngine();
    const dragged = engine.beginDrag(state(), { x: 300, y: 250 }, bounds.id, 100).state;
    const result = engine.release(dragged, {
      vxPxPerSec: 250,
      vyPxPerSec: -500,
      sampledAtMs: 150,
      sampleCount: 4,
      sampleSpanMs: 75,
    });

    expect(result.state).toMatchObject({
      phase: 'airborne',
      position: { x: 300, y: 250 },
      velocityPxPerSec: { x: 250, y: -500 },
      airborneElapsedSec: 0,
      peakGroundImpactSeverity: 0,
    });
    expect(result.events.map((event) => event.type)).toEqual(['released', 'airborne_started']);
  });

  it('rejects invalid physics constraints and bounds', () => {
    const invalidConstraints: MotionConstraints = {
      ...DEFAULT_MOTION_CONSTRAINTS,
      wallRestitution: 1.1,
    };
    expect(() => new MotionEngine(invalidConstraints)).toThrow(RangeError);

    const engine = new MotionEngine();
    expect(() =>
      engine.step({
        state: state({ phase: 'airborne' }),
        stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
        bounds: { ...bounds, width: 0 },
      })
    ).toThrow(RangeError);
  });
});
