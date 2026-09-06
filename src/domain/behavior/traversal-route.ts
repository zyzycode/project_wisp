import type { ActivityStep, VoluntaryLocomotionStep } from './activity-runner';
import type { ExplorePlan, ExplorePlanningContext } from './explore-planner';
import { DEFAULT_MOTION_CONSTRAINTS, calculateRootCollisionRange, planDirectedJump, type ScreenBoundsDto, type Vector2Dto } from './motion-engine';
import type { ExternalWindowSurface, WallSide } from './surface-kinematics';

/** Normalized route commands; never exposed as a Renderer position API. */
export type TraversalAction = {
  readonly bounds: ScreenBoundsDto;
  readonly supportId: string;
} & (
  | { readonly kind: 'screen_climb'; readonly side: WallSide; readonly direction: 'up' | 'down' }
  | { readonly kind: 'directed_jump'; readonly target: Vector2Dto; readonly targetSurface?: ExternalWindowSurface }
);
export interface TraversalRequest {
  readonly runId: string;
  readonly stepId: string;
  readonly action: TraversalAction;
}

/** One Explore goal; optional route geometry is chosen with the goal, not by a timer. */
export function createExploreTraversalSteps(plan: ExplorePlan, context: ExplorePlanningContext): readonly ActivityStep[] {
  const surface = context.environment.currentSurface;
  if (plan.targetSurface !== undefined || surface?.kind === 'window_top') {
    return createExternalRoute(plan, context) ?? [];
  }
  if (surface?.kind !== 'screen_floor' || !surface.isValidSupport
      || context.needs.energy < 70 || context.needs.comfort >= 75) return [];
  const bounds = context.environment.screenBounds;
  const range = calculateRootCollisionRange(bounds, context.collisionInsets);
  const origin = context.currentRootPosition;
  if (Math.abs(origin.y - range.maxY) > 1) return [];
  const common = { bounds: { ...bounds }, supportId: surface.id };
  const jumpStep: VoluntaryLocomotionStep = {
    id: 'jump_travel', actionId: 'jump_travel', type: 'locomotion', stage: 'looping',
    gait: 'walk', targetRef: plan.targetId, intent: { kind: 'jump' }, timeoutMs: 4_000,
    traversal: { ...common, kind: 'directed_jump', target: plan.targetRootPosition }, next: 'route_land',
  };
  const landing: ActivityStep = { id: 'route_land', actionId: 'land', type: 'animation', stage: 'exiting',
    intent: { kind: 'land' }, completion: { type: 'elapsed', durationMs: 500 }, next: 'inspect' };
  if (plan.pointKind === 'ordinary' && plan.distancePx <= 300
      && planDirectedJump(origin, plan.targetRootPosition, bounds, {
        ...DEFAULT_MOTION_CONSTRAINTS, collisionInsets: context.collisionInsets,
      }) !== null) return [jumpStep, landing];
  if (plan.pointKind !== 'interesting_surface') return [];
  const side = origin.x <= (range.minX + range.maxX) / 2 ? 'left' : 'right';
  const x = side === 'left' ? range.minX : range.maxX;
  if (Math.abs(origin.x - x) > 500 || Math.abs(origin.x - x) < 1 || range.maxY - range.minY < 100) return [];
  const reboundOrigin = { x, y: range.minY };
  if (planDirectedJump(reboundOrigin, plan.targetRootPosition, bounds, {
    ...DEFAULT_MOTION_CONSTRAINTS, collisionInsets: context.collisionInsets,
  }) === null) return [];
  return [
    { id: 'approach', actionId: 'approach_edge', type: 'locomotion', stage: 'entering', gait: 'walk',
      targetRef: `${surface.id}:${side}`, targetRootPosition: { x, y: range.maxY },
      intent: { kind: 'walk' }, timeoutMs: 7_000, next: 'grab_edge' },
    { id: 'grab_edge', actionId: 'grab_edge', type: 'animation', stage: 'entering',
      intent: { kind: 'climb_wall', loop: 'none' },
      completion: { type: 'elapsed', durationMs: 200 }, next: 'climb' },
    { id: 'climb', actionId: 'screen_climb', type: 'locomotion', stage: 'looping', gait: 'crawl',
      targetRef: `${surface.id}:${side}:top`, intent: { kind: 'climb_wall' },
      timeoutMs: (range.maxY - range.minY) / SCREEN_CLIMB_SPEED * 1000 + 1_000,
      traversal: { ...common, kind: 'screen_climb', side, direction: 'up' }, next: 'jump_travel' },
    jumpStep, landing,
  ];
}

export const SCREEN_CLIMB_SPEED = 220;

/** A route is admitted before scoring; airborne targets keep their observed geometry. */
export function createExternalRoute(plan: ExplorePlan, context: ExplorePlanningContext): readonly ActivityStep[] | null {
  const source = context.environment.currentSurface;
  if (source === undefined || !source.isValidSupport) return null;
  if (source.id === plan.surfaceId) {
    if (Math.abs(plan.targetRootPosition.x - context.currentRootPosition.x) < 1) return [];
    return [{ id: 'walk', actionId: `walk:${plan.routeKey}`, type: 'locomotion', stage: 'entering',
      gait: 'walk', targetRef: source.id, targetRootPosition: plan.targetRootPosition,
      ...(source.kind === 'window_top' ? { supportLocalDistancePx: plan.supportLocalDistancePx } : {}),
      intent: { kind: 'walk' }, timeoutMs: 7000, next: 'inspect' }];
  }
  if (source.kind !== 'screen_floor' && source.kind !== 'window_top') return null;
  const arc = planDirectedJump(context.currentRootPosition, plan.targetRootPosition, context.environment.screenBounds,
    { ...DEFAULT_MOTION_CONSTRAINTS, collisionInsets: context.collisionInsets });
  if (arc === null) return null;
  // Reject a path entering an observed window body, including the destination from below.
  for (const s of context.externalSurfaces ?? []) {
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
    if (maximumY > s.bounds.y + 0.000001 && minimumY < s.bounds.y + s.bounds.height - 0.000001) return null;
  }
  return [{ id: 'jump_travel', actionId: `jump:${plan.routeKey}`, type: 'locomotion', stage: 'entering',
    gait: 'walk', targetRef: plan.surfaceId, intent: { kind: 'jump' }, timeoutMs: 4000,
    traversal: { kind: 'directed_jump', supportId: source.id, bounds: context.environment.screenBounds,
      target: plan.targetRootPosition, targetSurface: plan.targetSurface }, next: 'route_land' },
    { id: 'route_land', actionId: 'land', type: 'animation', stage: 'entering', intent: { kind: 'land' },
      completion: { type: 'elapsed', durationMs: 500 }, next: 'inspect' }];
}
