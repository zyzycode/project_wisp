import { expect, it, vi } from 'vitest';
import { calculateNextWanderTarget, DEFAULT_BEHAVIOR_CONFIG, planWanderTarget } from '../../src/domain/behavior/autonomous-behavior';
import type { WanderTargetPlanningInput, WanderTargetPlanner } from '../../src/application/ports/wander-target-planner';

const planner: WanderTargetPlanner = planWanderTarget;
function input(): WanderTargetPlanningInput {
  return { currentPosition: { x: 180, y: 200 }, screenBounds: { id: 'screen', x: 0, y: 0, width: 500, height: 400 },
    currentSurface: { id: 'window', kind: 'window_top', bounds: { x: 90, y: 200, width: 130, height: 100 }, supportY: 200, isValidSupport: true },
    collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 }, prng: { next: vi.fn(() => .1) }, config: DEFAULT_BEHAVIOR_CONFIG };
}
it('uses window contact bounds and consumes exactly two random values', () => {
  const c = input(); const result = planner(c);
  expect(result.target.y).toBe(200); expect(result.target.x).toBeGreaterThanOrEqual(90); expect(result.target.x).toBeLessThan(180);
  expect(result.durationMs).toBeGreaterThan(0); expect(c.prng.next).toHaveBeenCalledTimes(2);
});
it.each([0, -1000])('intersects a partly offscreen top at display origin %i', origin => {
  const c = input(); const result = planner({ ...c, currentPosition: { x: origin + 100, y: 200 },
    screenBounds: { ...c.screenBounds, x: origin }, currentSurface: { ...c.currentSurface!, bounds: { x: origin - 80, y: 200, width: 300, height: 100 } } });
  expect(result.target.x).toBeGreaterThanOrEqual(origin + 50); expect(result.target.x).toBeLessThanOrEqual(origin + 220); expect(result.target.y).toBe(200);
});
it.each([
  { x: 600, y: 200, width: 100, height: 100 },
  { x: 90, y: 200, width: -1, height: 100 },
  { x: NaN, y: 200, width: 100, height: 100 },
  { x: 90, y: 20, width: 100, height: 100 },
])('does not move for an unusable support geometry %j', bounds => {
  const c = input(); expect(planner({ ...c, currentSurface: { ...c.currentSurface!, bounds, supportY: bounds.y } })).toEqual({ target: c.currentPosition, durationMs: 0 });
});
it.each([undefined, false])('preserves floor policy for absent/invalid support: %s', valid => {
  const c = input(); const currentSurface = valid === undefined ? undefined : { ...c.currentSurface!, isValidSupport: valid };
  expect(planner({ ...c, currentSurface })).toEqual(calculateNextWanderTarget(c.currentPosition, c.screenBounds, { next: () => .1 }, c.collisionInsets, c.config));
  expect(c.prng.next).toHaveBeenCalledTimes(2);
});
