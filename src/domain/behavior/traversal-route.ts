import { createExternalRoute, SCREEN_CLIMB_SPEED } from './external-window-route';
export { createExternalRoute, SCREEN_CLIMB_SPEED } from './external-window-route';
import type { ActivityStep, VoluntaryLocomotionStep } from './activity-runner';
import type { ExplorePlan, ExplorePlanningContext } from './explore-planner';
import { DEFAULT_MOTION_CONSTRAINTS, calculateRootCollisionRange, planDirectedJump, type ScreenBoundsDto, type Vector2Dto } from './motion-engine';
import type { ExternalWindowSurface, WallSide } from './surface-kinematics';

/** Normalized route commands; never exposed as a Renderer position API. */
export type TraversalAction = {
  readonly bounds: ScreenBoundsDto;
  readonly supportId: string;
} & (
  | { readonly kind: 'screen_climb'; readonly side: WallSide; readonly direction: 'up' | 'down'; readonly targetSurface?: ExternalWindowSurface }
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
    gait: 'walk', targetRef: plan.targetId, intent: { kind: 'jump_travel' }, timeoutMs: 4_000,
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
      intent: { kind: 'grab_edge', loop: 'none' },
      completion: { type: 'elapsed', durationMs: 200 }, next: 'climb' },
    { id: 'climb', actionId: 'screen_climb', type: 'locomotion', stage: 'looping', gait: 'crawl',
      targetRef: `${surface.id}:${side}:top`, intent: { kind: 'climb_wall' },
      timeoutMs: (range.maxY - range.minY) / SCREEN_CLIMB_SPEED * 1000 + 1_000,
      traversal: { ...common, kind: 'screen_climb', side, direction: 'up' }, next: 'jump_travel' },
    jumpStep, landing,
  ];
}
