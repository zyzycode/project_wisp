import { describe, expect, it } from 'vitest';
import { createExplorePlanCandidates, type ExplorePlan, type ExplorePlanningContext } from '../../src/domain/behavior/explore-planner';
import { createExternalRoute } from '../../src/domain/behavior/traversal-route';
import { DEFAULT_MOTION_CONSTRAINTS, planDirectedJump } from '../../src/domain/behavior/motion-engine';
import { selectRestSpot } from '../../src/domain/behavior/rest-spot-planner';
import type { ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';

const bounds = { id: 'screen', x: 0, y: 0, width: 1920, height: 1080 };
const top: ExternalWindowSurface = { id: 'top', kind: 'window_top', bounds: { x: 300, y: 250, width: 900, height: 600 }, supportY: 250, isValidSupport: true };
const context: ExplorePlanningContext = {
  currentRootPosition: { x: 650, y: 1070 },
  environment: { capturedAtMs: 0, screenBounds: bounds, currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } },
  collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
  externalSurfaces: [top], nowMs: 0, history: { entries: [] }, tone: 'neutral',
  needs: { energy: 60, comfort: 20, attention: 20, play: 20, boredom: 50 },
};
const plan: ExplorePlan = {
  targetId: 'top:450', surfaceId: top.id, surfaceKind: top.kind, targetSurface: top,
  targetRootPosition: { x: 750, y: 250 }, supportLocalDistancePx: 450,
  routeKey: 'top:right', pointKind: 'ordinary', inspection: 'look_around', pose: 'none',
  choreographyKey: 'look_around:none', distancePx: Math.hypot(100, 820),
};

describe('window above Wisp blocks the direct jump', () => {
  it('keeps external goals beyond 500 DIP and lets route feasibility decide', () => {
    const candidates = createExplorePlanCandidates({ ...context,
      environment: { ...context.environment, currentSurface: top },
      isReachable: candidate => createExternalRoute(candidate, context) !== null,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(candidate => candidate.distancePx > 500)).toBe(true);
    expect(selectRestSpot(context, true)?.target.surfaceKind).toBe('window_top');
  });

  it('approaches the screen side, climbs, lands near the window edge and walks on the support', () => {
    const route = createExternalRoute(plan, context);
    expect(route?.map(step => step.id)).toEqual(['approach', 'grab_edge', 'climb', 'jump_travel', 'route_land', 'walk_support']);
    expect(route?.[0]).toMatchObject({ targetRootPosition: { x: 50, y: 1070 } });
    expect(route?.[2]).toMatchObject({ traversal: { kind: 'screen_climb', side: 'left' } });
    expect(route?.[3]).toMatchObject({ traversal: { kind: 'directed_jump', targetSurface: top, target: { y: 250 } } });
    expect(route?.at(-1)).toMatchObject({ targetRef: 'top', supportLocalDistancePx: 450, next: 'inspect' });
    const jump = route?.[3];
    if (jump?.type !== 'locomotion' || jump.traversal?.kind !== 'directed_jump') throw new Error('Missing jump');
    const arc = planDirectedJump({ x: 50, y: 90 }, jump.traversal.target, bounds,
      { ...DEFAULT_MOTION_CONSTRAINTS, collisionInsets: context.collisionInsets })!;
    for (let i = 0; i <= 100; i++) {
      const t = arc.durationSec * i / 100;
      const x = arc.origin.x + arc.initialVelocity.x * t;
      const y = arc.origin.y + arc.initialVelocity.y * t + arc.gravity * t * t / 2;
      expect(x > 300 && x < 1200 && y > 250.000001 && y < 850).toBe(false);
    }
  });

  it('keeps every seed on the support even when Wisp is far to its right', () => {
    const candidates = createExplorePlanCandidates({ ...context, currentRootPosition: { x: 1850, y: 1070 },
      environment: { ...context.environment, currentSurface: top } });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(p => p.targetRootPosition.x >= 300 && p.targetRootPosition.x <= 1200)).toBe(true);
  });

  it('tries the other screen side when the nearest climb is obstructed', () => {
    const nearerRightTop: ExternalWindowSurface = { ...top, bounds: { ...top.bounds, width: 1300 } };
    const blocker: ExternalWindowSurface = { ...top, id: 'blocker', bounds: { x: 0, y: 100, width: 100, height: 800 }, supportY: 100 };
    const route = createExternalRoute({ ...plan, targetSurface: nearerRightTop }, { ...context, externalSurfaces: [nearerRightTop, blocker] });
    expect(route?.find(s => s.id === 'climb')).toMatchObject({ traversal: { side: 'right' } });
  });

  it('omits a zero-distance approach when already at the screen side', () => {
    const route = createExternalRoute(plan, { ...context, currentRootPosition: { x: 50, y: 1070 } });
    expect(route?.[0]?.id).toBe('grab_edge');
  });

  it('does not clamp a maximized top into a fictional support inside the screen', () => {
    const maximized: ExternalWindowSurface = { ...top, bounds: { ...bounds }, supportY: 0 };
    expect(createExplorePlanCandidates({ ...context, environment: { ...context.environment, currentSurface: maximized } })).toEqual([]);
    expect(createExternalRoute({ ...plan, targetSurface: maximized, targetRootPosition: { x: 750, y: 0 } }, { ...context, externalSurfaces: [maximized] })).toBeNull();
  });

  it('rejects a detour when another window blocks both screen sides', () => {
    const blocker: ExternalWindowSurface = { ...top, id: 'blocker', bounds: { x: 0, y: 100, width: 1920, height: 700 }, supportY: 100 };
    expect(createExternalRoute(plan, { ...context, externalSurfaces: [top, blocker] })).toBeNull();
  });
});
