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
  it('keeps the calibrated motion profile aligned as one coherent constraint set', () => {
    expect(DEFAULT_MOTION_CONSTRAINTS).toEqual({
      gravityPxPerSec2: 1800,
      linearDampingXPerSec: 0.35,
      linearDampingYPerSec: 0.08,
      fixedStepSec: 1 / 120,
      maxFrameDeltaSec: 0.25,
      maxSpeedPxPerSec: 2400,
      wallRestitution: 0.45,
      ceilingRestitution: 0.3,
      floorRestitution: 0.3,
      floorTangentialRetention: 0.72,
      minBounceNormalSpeedPxPerSec: 160,
      settleNormalSpeedPxPerSec: 120,
      settleTangentialSpeedPxPerSec: 90,
      softLandingMaxSeverity: 420,
      stumbleMaxSeverity: 950,
      collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
      throwSampling: {
        windowMs: 100,
        maxSamples: 8,
        minSpanMs: 24,
        maxThrowSpeedPxPerSec: 2200,
      },
    });

    expect(DEFAULT_MOTION_CONSTRAINTS.minBounceNormalSpeedPxPerSec).toBeGreaterThanOrEqual(
      DEFAULT_MOTION_CONSTRAINTS.settleNormalSpeedPxPerSec
    );
    expect(DEFAULT_MOTION_CONSTRAINTS.softLandingMaxSeverity).toBeLessThan(
      DEFAULT_MOTION_CONSTRAINTS.stumbleMaxSeverity
    );
    expect(DEFAULT_MOTION_CONSTRAINTS.throwSampling.maxThrowSpeedPxPerSec).toBeLessThanOrEqual(
      DEFAULT_MOTION_CONSTRAINTS.maxSpeedPxPerSec
    );
  });

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

  it('uses only recent finite cursor samples and caps the sliding window sample count', () => {
    const engine = new MotionEngine();
    const throwVector = engine.estimateThrow(
      [
        { position: { x: -5000, y: 0 }, capturedAtMs: 899 },
        ...Array.from({ length: 10 }, (_, index) => ({
          position: { x: -1920 + index * 10, y: 300 + index * 5 },
          capturedAtMs: 910 + index * 10,
        })),
        { position: { x: Number.NaN, y: 0 }, capturedAtMs: 1000 },
        { position: { x: -1800, y: 360 }, capturedAtMs: 1001 },
      ],
      1000
    );

    expect(throwVector).toMatchObject({
      sampledAtMs: 1000,
      sampleCount: DEFAULT_MOTION_CONSTRAINTS.throwSampling.maxSamples,
      sampleSpanMs: 70,
    });
    expect(throwVector.vxPxPerSec).toBeCloseTo(1000, 8);
    expect(throwVector.vyPxPerSec).toBeCloseTo(500, 8);
  });

  it('applies gravity, exponential air damping, and semi-implicit position integration', () => {
    const engine = new MotionEngine();
    const airborne = state({
      phase: 'airborne',
      position: { x: 500, y: 400 },
      velocityPxPerSec: { x: 100, y: -200 },
    });
    const result = engine.step({ state: airborne, stepSec: 0.1, bounds });
    const expectedVx =
      100 * Math.exp(-DEFAULT_MOTION_CONSTRAINTS.linearDampingXPerSec * 0.1);
    const expectedVy =
      (-200 + DEFAULT_MOTION_CONSTRAINTS.gravityPxPerSec2 * 0.1) *
      Math.exp(-DEFAULT_MOTION_CONSTRAINTS.linearDampingYPerSec * 0.1);

    expect(result.state.velocityPxPerSec.x).toBeCloseTo(expectedVx, 8);
    expect(result.state.velocityPxPerSec.y).toBeCloseTo(expectedVy, 8);
    expect(result.state.position.x).toBeCloseTo(500 + expectedVx * 0.1, 8);
    expect(result.state.position.y).toBeCloseTo(400 + expectedVy * 0.1, 8);
    expect(result.events).toEqual([]);
  });

  it('clamps offset viewport walls and ceiling with calibrated restitution', () => {
    const engine = new MotionEngine();
    const offsetBounds: ScreenBoundsDto = {
      id: 'left-monitor',
      x: -1920,
      y: -200,
      width: 1920,
      height: 1080,
    };
    const leftX = offsetBounds.x + DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left;
    const topY = offsetBounds.y + DEFAULT_MOTION_CONSTRAINTS.collisionInsets.top;
    const wallResult = engine.step({
      state: state({
        phase: 'airborne',
        position: { x: leftX + 1, y: 400 },
        velocityPxPerSec: { x: -500, y: 0 },
      }),
      stepSec: 0.1,
      bounds: offsetBounds,
    });
    const dampedWallSpeed =
      500 * Math.exp(-DEFAULT_MOTION_CONSTRAINTS.linearDampingXPerSec * 0.1);

    expect(wallResult.state.position.x).toBe(leftX);
    expect(wallResult.state.velocityPxPerSec.x).toBeCloseTo(
      dampedWallSpeed * DEFAULT_MOTION_CONSTRAINTS.wallRestitution,
      8
    );
    expect(wallResult.events).toContainEqual(
      expect.objectContaining({ type: 'collision', side: 'left' })
    );

    const ceilingResult = engine.step({
      state: state({
        phase: 'airborne',
        position: { x: -960, y: topY + 1 },
        velocityPxPerSec: { x: 0, y: -500 },
      }),
      stepSec: 0.1,
      bounds: offsetBounds,
    });
    const dampedCeilingSpeed =
      (-500 + DEFAULT_MOTION_CONSTRAINTS.gravityPxPerSec2 * 0.1) *
      Math.exp(-DEFAULT_MOTION_CONSTRAINTS.linearDampingYPerSec * 0.1);

    expect(ceilingResult.state.position.y).toBe(topY);
    expect(ceilingResult.state.velocityPxPerSec.y).toBeCloseTo(
      -dampedCeilingSpeed * DEFAULT_MOTION_CONSTRAINTS.ceilingRestitution,
      8
    );
    expect(ceilingResult.events).toContainEqual(
      expect.objectContaining({ type: 'collision', side: 'top' })
    );
  });

  it('applies floor restitution and tangential retention as one bounce response', () => {
    const constraints: MotionConstraints = {
      ...DEFAULT_MOTION_CONSTRAINTS,
      gravityPxPerSec2: 0,
      linearDampingXPerSec: 0,
      linearDampingYPerSec: 0,
    };
    const engine = new MotionEngine(constraints);
    const result = engine.step({
      state: state({
        phase: 'airborne',
        position: { x: 500, y: floorY - 1 },
        velocityPxPerSec: { x: 100, y: 200 },
      }),
      stepSec: 0.01,
      bounds,
    });

    expect(result.state.phase).toBe('airborne');
    expect(result.state.position.y).toBe(floorY);
    expect(result.state.velocityPxPerSec).toEqual({
      x: 100 * constraints.floorTangentialRetention,
      y: -200 * constraints.floorRestitution,
    });
    expect(result.events).toContainEqual({
      type: 'collision',
      side: 'bottom',
      normalSpeedPxPerSec: 200,
    });
  });

  it('reduces floor tangential speed deterministically until the pet settles', () => {
    const constraints: MotionConstraints = {
      ...DEFAULT_MOTION_CONSTRAINTS,
      gravityPxPerSec2: 0,
      linearDampingXPerSec: 0,
      linearDampingYPerSec: 0,
    };
    const engine = new MotionEngine(constraints);
    let current = state({
      phase: 'airborne',
      position: { x: 500, y: floorY },
      velocityPxPerSec: { x: 200, y: 0 },
    });

    const first = engine.step({ state: current, stepSec: constraints.fixedStepSec, bounds });
    current = first.state;
    const second = engine.step({ state: current, stepSec: constraints.fixedStepSec, bounds });
    current = second.state;
    const third = engine.step({ state: current, stepSec: constraints.fixedStepSec, bounds });

    expect(first.state.phase).toBe('airborne');
    expect(first.state.velocityPxPerSec.x).toBeCloseTo(200 * 0.72, 8);
    expect(second.state.phase).toBe('airborne');
    expect(second.state.velocityPxPerSec.x).toBeCloseTo(200 * 0.72 ** 2, 8);
    expect(third.state.phase).toBe('grounded');
    expect(third.state.velocityPxPerSec).toEqual({ x: 0, y: 0 });
    expect(third.events).toContainEqual(
      expect.objectContaining({ type: 'landed', outcome: 'soft_landing' })
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

  it.each([
    ['soft_landing', DEFAULT_MOTION_CONSTRAINTS.softLandingMaxSeverity],
    ['stumble', DEFAULT_MOTION_CONSTRAINTS.softLandingMaxSeverity + Number.EPSILON * 2048],
    ['stumble', DEFAULT_MOTION_CONSTRAINTS.stumbleMaxSeverity],
    ['crash_landing', DEFAULT_MOTION_CONSTRAINTS.stumbleMaxSeverity + Number.EPSILON * 8192],
  ] as const)('keeps landing threshold boundary %s at severity %s', (expectedOutcome, severity) => {
    const engine = new MotionEngine({
      ...DEFAULT_MOTION_CONSTRAINTS,
      gravityPxPerSec2: 0,
      linearDampingXPerSec: 0,
      linearDampingYPerSec: 0,
    });
    const result = engine.step({
      state: state({
        phase: 'airborne',
        position: { x: 500, y: floorY },
        velocityPxPerSec: { x: 0, y: 0 },
        peakGroundImpactSeverity: severity,
      }),
      stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
      bounds,
    });

    expect(result.events).toContainEqual({
      type: 'landed',
      outcome: expectedOutcome,
      impactSeverity: severity,
    });
  });

  it('keeps a cursor-derived throw finite and inside a negatively offset viewport', () => {
    const viewport: ScreenBoundsDto = {
      id: 'left-monitor',
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080,
    };
    const minX = viewport.x + DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left;
    const maxX = viewport.x + viewport.width - DEFAULT_MOTION_CONSTRAINTS.collisionInsets.right;
    const minY = viewport.y + DEFAULT_MOTION_CONSTRAINTS.collisionInsets.top;
    const maxY = viewport.y + viewport.height - DEFAULT_MOTION_CONSTRAINTS.collisionInsets.bottom;
    const engine = new MotionEngine();
    const throwVector = engine.estimateThrow(
      [
        { position: { x: -160, y: 380 }, capturedAtMs: 900 },
        { position: { x: -100, y: 320 }, capturedAtMs: 950 },
        { position: { x: -40, y: 260 }, capturedAtMs: 1000 },
      ],
      1000
    );
    const dragged = engine.beginDrag(
      state({ activeBoundsId: viewport.id }),
      { x: maxX - 5, y: 260 },
      viewport.id,
      900
    ).state;
    let current = engine.release(dragged, throwVector).state;

    expect(Math.hypot(current.velocityPxPerSec.x, current.velocityPxPerSec.y)).toBeLessThanOrEqual(
      DEFAULT_MOTION_CONSTRAINTS.throwSampling.maxThrowSpeedPxPerSec
    );

    for (let index = 0; index < 5000 && current.phase !== 'grounded'; index += 1) {
      const result = engine.step({
        state: current,
        stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
        bounds: viewport,
      });
      current = result.state;

      expect(Number.isFinite(current.position.x)).toBe(true);
      expect(Number.isFinite(current.position.y)).toBe(true);
      expect(Number.isFinite(current.velocityPxPerSec.x)).toBe(true);
      expect(Number.isFinite(current.velocityPxPerSec.y)).toBe(true);
      expect(current.position.x).toBeGreaterThanOrEqual(minX);
      expect(current.position.x).toBeLessThanOrEqual(maxX);
      expect(current.position.y).toBeGreaterThanOrEqual(minY);
      expect(current.position.y).toBeLessThanOrEqual(maxY);
      expect(Math.hypot(current.velocityPxPerSec.x, current.velocityPxPerSec.y)).toBeLessThanOrEqual(
        DEFAULT_MOTION_CONSTRAINTS.maxSpeedPxPerSec + Number.EPSILON
      );
    }

    expect(current.phase).toBe('grounded');
    expect(current.activeBoundsId).toBe(viewport.id);
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

    expect(() =>
      engine.step({
        state: state({ phase: 'airborne' }),
        stepSec: DEFAULT_MOTION_CONSTRAINTS.fixedStepSec,
        bounds: {
          ...bounds,
          width:
            DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left +
            DEFAULT_MOTION_CONSTRAINTS.collisionInsets.right -
            1,
        },
      })
    ).toThrow(RangeError);
  });
});
