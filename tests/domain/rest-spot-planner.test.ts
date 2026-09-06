import { describe, expect, it } from 'vitest';
import { createRestSpotActivity, selectRestSpot } from '../../src/domain/behavior/rest-spot-planner';
import { createExternalRoute } from '../../src/domain/behavior/traversal-route';
import { createExplorePlanCandidates, scoreExplorePlans, type ExplorePlanningContext } from '../../src/domain/behavior/explore-planner';
import type { ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
const top: ExternalWindowSurface = { id: 'window', kind: 'window_top', bounds: { x: 300, y: 400, width: 300, height: 200 }, supportY: 400, isValidSupport: true };
function context(): ExplorePlanningContext {
  return { currentRootPosition: { x: 100, y: 790 }, environment: { capturedAtMs: 0, screenBounds: bounds,
    currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } },
    collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 }, needs: { energy: 60, attention: 20, play: 20, comfort: 20, boredom: 50 },
    tone: 'neutral', nowMs: 1000, history: { entries: [] }, externalSurfaces: [top] };
}
describe('AUTO-I06 rest and route planning', () => {
  it('selects a reachable rest spot and gives nap an explicit wake phase', () => {
    const plan = selectRestSpot(context(), true)!;
    expect(plan.route[0]?.type).toBe('locomotion');
    const activity = createRestSpotActivity(plan);
    expect(activity.steps.find(s => s.id === 'sleep')).toMatchObject({ completion: { durationMs: 12000 }, next: 'wake' });
    expect(activity.steps.at(-1)?.id).toBe('wake');
  });
  it('uses the same sleep animations on windows and the floor', () => {
    const plan = selectRestSpot(context(), false)!;
    const animations = (surfaceKind: 'screen_floor' | 'window_top') => createRestSpotActivity({
      ...plan, target: { ...plan.target, surfaceKind },
    }).steps.filter(s => s.type === 'animation').map(s => s.intent.kind);
    expect(animations('window_top')).toEqual(animations('screen_floor'));
    expect(animations('window_top')).toContain('sleep_loop');
  });
  it('falls back to a quiet floor edge when external observations are unavailable', () => {
    const plan = selectRestSpot({ ...context(), externalSurfaces: [] }, true)!;
    expect(plan.target.surfaceKind).toBe('screen_floor');
    expect(['edge', 'corner']).toContain(plan.target.pointKind);
  });
  it('rejects routes entering an observed window and applies history to the same targets', () => {
    const c = context();
    const plans = createExplorePlanCandidates({ ...c, environment: { ...c.environment, currentSurface: top } });
    const reachable = plans.find(plan => createExternalRoute(plan, c) !== null)!;
    expect(reachable).toBeDefined();
    const blocker: ExternalWindowSurface = { ...top, id: 'blocker', bounds: { x: 50, y: 90, width: 600, height: 690 }, supportY: 90 };
    expect(createExternalRoute(reachable, { ...c, externalSurfaces: [top, blocker] })).toBeNull();
    const previous = { targetId: reachable.targetId, routeKey: reachable.routeKey, choreographyKey: reachable.choreographyKey, selectedAtMs: c.nowMs };
    expect(scoreExplorePlans([reachable], { ...c, history: { entries: [previous] } })[0]!.weight).toBeLessThan(scoreExplorePlans([reachable], c)[0]!.weight);
  });
});
