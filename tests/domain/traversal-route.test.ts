import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION_CONSTRAINTS, MotionEngine, planDirectedJump, type MotionState } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';
import { createExploreTraversalSteps } from '../../src/domain/behavior/traversal-route';
import { createExplorePlanCandidates, type ExplorePlanningContext } from '../../src/domain/behavior/explore-planner';

const bounds = { id: 'screen', x: -1000, y: -200, width: 1000, height: 800 };
const origin = { x: -800, y: 590 };
const environment = { capturedAtMs: 0, screenBounds: bounds,
  currentSurface: { id: 'floor', kind: 'screen_floor' as const, bounds, isValidSupport: true } };
const context: ExplorePlanningContext = {
  currentRootPosition: origin, environment, collisionInsets: DEFAULT_MOTION_CONSTRAINTS.collisionInsets,
  needs: { energy: 90, attention: 20, play: 50, boredom: 80, comfort: 20 },
  tone: 'curious', history: { entries: [] }, nowMs: 0,
};
const motion: MotionState = { phase: 'grounded', position: origin, velocityPxPerSec: { x: 0, y: 0 },
  activeBoundsId: bounds.id, airborneElapsedSec: 0, peakGroundImpactSeverity: 0 };

describe('AUTO-I04 route geometry', () => {
  it('abandons an arc that no longer fits the screen and uses ordinary collision physics', () => {
    const engine = new MotionEngine();
    const plan = planDirectedJump(origin, { x: -550, y: 590 }, bounds)!;
    const launched = engine.beginAirborne(motion, { cause: 'voluntary_jump', position: origin,
      velocityPxPerSec: plan.initialVelocity, boundsId: bounds.id, atMs: 0, directedJump: plan });
    const result = engine.step({ state: launched.state, stepSec: .3,
      bounds: { ...bounds, width: 210 } });
    expect(result.state.directedJump).toBeUndefined();
    expect(result.events[0]).toEqual({ type: 'jump_missed' });
    expect(result.state.position.x).toBeLessThanOrEqual(-840);
  });

  it.each([1 / 120, 1 / 60, .031])('lands the same parabola on its single target with step %s', (stepSec) => {
    const engine = new MotionEngine();
    const target = { x: -550, y: 590 };
    const plan = planDirectedJump(origin, target, bounds)!;
    expect(plan).not.toBeNull();
    let result = engine.beginAirborne(motion, { cause: 'voluntary_jump', position: origin,
      velocityPxPerSec: plan.initialVelocity, boundsId: bounds.id, atMs: 0, directedJump: plan });
    const events = [...result.events];
    for (let i = 0; i < 400 && result.state.phase !== 'grounded'; i++) {
      result = engine.step({ state: result.state, stepSec, bounds });
      events.push(...result.events);
    }
    expect(result.state.position).toEqual(target);
    expect(events.filter(e => e.type === 'landed')).toEqual([{ type: 'landed', outcome: 'soft_landing', impactSeverity: 0 }]);
    expect(events.filter(e => e.type === 'jump_descending')).toHaveLength(1);
  });

  it.each([-950, -50])('rebounds inward from screen root limit %s without a ceiling collision', (x) => {
    const plan = planDirectedJump({ x, y: -110 }, { x: -500, y: 590 }, bounds)!;
    expect(plan.initialVelocity.y).toBe(0);
    expect(Math.sign(plan.initialVelocity.x)).toBe(x === -950 ? 1 : -1);
    expect(plan.origin.y).toBe(-110);
  });

  it('rejects NaN, off-screen and excessive-speed targets instead of clamping', () => {
    expect(planDirectedJump(origin, { x: NaN, y: 590 }, bounds)).toBeNull();
    expect(planDirectedJump(origin, { x: 5, y: 590 }, bounds)).toBeNull();
    expect(planDirectedJump({ x: -950, y: -110 }, { x: -50, y: -110 }, bounds)).toBeNull();
  });

  it('plans approach/grab/climb/rebound inside Explore with one original final target', () => {
    const plan = createExplorePlanCandidates(context).find(p => p.pointKind === 'interesting_surface')!;
    const steps = createExploreTraversalSteps(plan, context);
    expect(steps.map(step => step.id)).toEqual(['approach', 'grab_edge', 'climb', 'jump_travel', 'route_land']);
    expect(steps[3]).toMatchObject({ traversal: { kind: 'directed_jump', target: plan.targetRootPosition } });
    expect(createExploreTraversalSteps(plan, { ...context, needs: { ...context.needs, energy: 20 } })).toEqual([]);
  });

  it.each(['up', 'down'] as const)('stops %s climbing once at the inset root limit', (direction) => {
    const surface = new SurfaceKinematics();
    const engine = new MotionEngine();
    const started = surface.startWallClimb({ motion: { ...motion, position: { x: -950, y: 0 } }, environment,
      side: 'left', verticalSpeedPxPerSec: direction === 'up' ? -220 : 220, nowMs: 0,
      climbLimits: { minX: -950, maxX: -50, minY: -110, maxY: 590 } })!;
    const result = surface.step({ state: started.state, motion: started.motion.state, environment, nowMs: 5000 }, engine);
    expect(result.motion.state.position).toEqual({ x: -950, y: direction === 'up' ? -110 : 590 });
    expect(result.events).toEqual([{ type: 'wall_limit_reached', end: direction === 'up' ? 'top' : 'floor' }]);
    expect(surface.step({ state: result.state, motion: result.motion.state, environment, nowMs: 5010 }, engine).events).toEqual([]);
  });
});
