import type { ActivityStep } from './activity-runner';
import { DEFAULT_BEHAVIOR_CONFIG } from './autonomous-behavior';
import type { ExplorePlan, ExplorePlanningContext } from './explore-planner';
import { DEFAULT_MOTION_CONSTRAINTS, calculateRootCollisionRange, planDirectedJump, type DirectedJump, type Vector2Dto } from './motion-engine';
import type { ExternalWindowSurface, WallSide } from './surface-kinematics';

export const SCREEN_CLIMB_SPEED = 220;

function walkTimeout(distance: number): number {
  return Math.max(7000, distance / DEFAULT_BEHAVIOR_CONFIG.wanderSpeedPxPerSec * 1000 + 1000);
}

function clearArc(arc: DirectedJump, surfaces: readonly ExternalWindowSurface[]): boolean {
  for (const s of surfaces) {
    const vx = arc.initialVelocity.x;
    if (vx === 0 && (arc.origin.x <= s.bounds.x || arc.origin.x >= s.bounds.x + s.bounds.width)) continue;
    const left = vx === 0 ? 0 : (s.bounds.x - arc.origin.x) / vx;
    const right = vx === 0 ? arc.durationSec : (s.bounds.x + s.bounds.width - arc.origin.x) / vx;
    const enter = Math.max(0.000001, Math.min(left, right));
    const exit = Math.min(arc.durationSec - 0.000001, Math.max(left, right));
    if (enter >= exit) continue;
    const y = (t: number): number => arc.origin.y + arc.initialVelocity.y * t + arc.gravity * t * t / 2;
    const apex = Math.max(enter, Math.min(exit, -arc.initialVelocity.y / arc.gravity));
    const minimumY = Math.min(y(enter), y(exit), y(apex));
    const maximumY = Math.max(y(enter), y(exit));
    if (maximumY > s.bounds.y + 0.000001 && minimumY < s.bounds.y + s.bounds.height - 0.000001) return false;
  }
  return true;
}

/** Only axis-aligned approach/climb/support-walk segments are admitted here. */
function clearSegment(a: Vector2Dto, b: Vector2Dto, surfaces: readonly ExternalWindowSurface[]): boolean {
  return surfaces.every(({ bounds: r }) => a.y === b.y
    ? a.y <= r.y || a.y >= r.y + r.height || Math.max(a.x, b.x) <= r.x || Math.min(a.x, b.x) >= r.x + r.width
    : a.x === b.x && (a.x <= r.x || a.x >= r.x + r.width || Math.max(a.y, b.y) <= r.y || Math.min(a.y, b.y) >= r.y + r.height));
}

function jumpSteps(plan: ExplorePlan, context: ExplorePlanningContext, target = plan.targetRootPosition, next = 'inspect'): readonly ActivityStep[] {
  return [{ id: 'jump_travel', actionId: `jump:${plan.routeKey}`, type: 'locomotion', stage: 'entering',
    gait: 'walk', targetRef: plan.surfaceId, intent: { kind: 'jump' }, timeoutMs: 4000,
    traversal: { kind: 'directed_jump', supportId: context.environment.currentSurface!.id, bounds: context.environment.screenBounds,
      target, targetSurface: plan.targetSurface }, next: 'route_land' },
  { id: 'route_land', actionId: 'land', type: 'animation', stage: 'entering', intent: { kind: 'land' },
    completion: { type: 'elapsed', durationMs: 500 }, next }];
}

/** Prefer a clear direct jump; otherwise reuse the screen wall's existing climb FSM. */
export function createExternalRoute(plan: ExplorePlan, context: ExplorePlanningContext): readonly ActivityStep[] | null {
  const source = context.environment.currentSurface;
  if (source === undefined || !source.isValidSupport) return null;
  const bounds = context.environment.screenBounds;
  let range;
  try { range = calculateRootCollisionRange(bounds, context.collisionInsets); } catch { return null; }
  const inside = (p: Vector2Dto): boolean => Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= range.minX && p.x <= range.maxX && p.y >= range.minY && p.y <= range.maxY;
  if (!inside(context.currentRootPosition) || !inside(plan.targetRootPosition)) return null;
  const surfaces = context.externalSurfaces ?? [];
  if (source.id === plan.surfaceId) {
    if (!clearSegment(context.currentRootPosition, plan.targetRootPosition, surfaces)) return null;
    if (Math.abs(plan.targetRootPosition.x - context.currentRootPosition.x) < 1) return [];
    return [{ id: 'walk', actionId: `walk:${plan.routeKey}`, type: 'locomotion', stage: 'entering',
      gait: 'walk', targetRef: source.id, targetRootPosition: plan.targetRootPosition,
      ...(source.kind === 'window_top' ? { supportLocalDistancePx: plan.supportLocalDistancePx } : {}),
      intent: { kind: 'walk' }, timeoutMs: walkTimeout(plan.distancePx), next: 'inspect' }];
  }
  if (source.kind !== 'screen_floor' && source.kind !== 'window_top') return null;
  const constraints = { ...DEFAULT_MOTION_CONSTRAINTS, collisionInsets: context.collisionInsets };
  const arc = planDirectedJump(context.currentRootPosition, plan.targetRootPosition, bounds, constraints);
  if (arc !== null && clearArc(arc, surfaces)) return jumpSteps(plan, context);
  const top = plan.targetSurface;
  if (source.kind !== 'screen_floor' || top?.kind !== 'window_top'
      || Math.abs(context.currentRootPosition.y - range.maxY) > 1) return null;
  const sides: readonly WallSide[] = context.currentRootPosition.x <= (range.minX + range.maxX) / 2
    ? ['left', 'right'] : ['right', 'left'];
  for (const side of sides) {
    const x = side === 'left' ? range.minX : range.maxX;
    const approach = { x, y: range.maxY };
    const rebound = { x, y: range.minY };
    const left = Math.max(range.minX, top.bounds.x);
    const right = Math.min(range.maxX, top.bounds.x + top.bounds.width);
    const margin = Math.min(48, (right - left) / 2);
    const landing = { x: side === 'left' ? left + margin : right - margin, y: top.supportY };
    if (left >= right || !clearSegment(context.currentRootPosition, approach, surfaces)
        || !clearSegment(approach, rebound, surfaces) || !clearSegment(landing, plan.targetRootPosition, surfaces)) continue;
    const jump = planDirectedJump(rebound, landing, bounds, constraints);
    if (jump === null || !clearArc(jump, surfaces)) continue;
    const walkDistance = Math.abs(landing.x - plan.targetRootPosition.x);
    const steps: ActivityStep[] = [];
    if (Math.abs(context.currentRootPosition.x - x) >= 1) steps.push({
      id: 'approach', actionId: 'approach_edge', type: 'locomotion', stage: 'entering', gait: 'walk',
      targetRef: `${source.id}:${side}`, targetRootPosition: approach, intent: { kind: 'walk' },
      timeoutMs: walkTimeout(Math.abs(context.currentRootPosition.x - x)), next: 'grab_edge',
    });
    steps.push(
      { id: 'grab_edge', actionId: 'grab_edge', type: 'animation', stage: 'entering', intent: { kind: 'climb_wall', loop: 'none' },
        completion: { type: 'elapsed', durationMs: 200 }, next: 'climb' },
      { id: 'climb', actionId: 'screen_climb', type: 'locomotion', stage: 'looping', gait: 'crawl',
        targetRef: `${source.id}:${side}:top`, intent: { kind: 'climb_wall' },
        timeoutMs: (range.maxY - range.minY) / SCREEN_CLIMB_SPEED * 1000 + 1000,
        traversal: { kind: 'screen_climb', bounds, supportId: source.id, side, direction: 'up', targetSurface: top }, next: 'jump_travel' },
      ...jumpSteps(plan, context, landing, walkDistance >= 1 ? 'walk_support' : 'inspect'),
    );
    if (walkDistance >= 1) steps.push({
      id: 'walk_support', actionId: `walk:${plan.routeKey}`, type: 'locomotion', stage: 'entering', gait: 'walk',
      targetRef: top.id, supportLocalDistancePx: plan.targetRootPosition.x - top.bounds.x,
      intent: { kind: 'walk' }, timeoutMs: walkTimeout(walkDistance), next: 'inspect',
    });
    return steps;
  }
  return null;
}
