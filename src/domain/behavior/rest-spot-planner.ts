import { isExternalSurface } from './external-surface-support';
import type { ActivityDefinition, ActivityStep } from './activity-runner';
import { DEFAULT_EXPLORE_PLANNER_CONFIG, createExplorePlanCandidates, scoreExplorePlans, type ExplorePlan, type ExplorePlanningContext } from './explore-planner';
import { createExternalRoute } from './traversal-route';

export interface RestSpotPlan { readonly target: ExplorePlan; readonly nap: boolean; readonly route: readonly ActivityStep[] }
export function selectRestSpot(context: ExplorePlanningContext, nap: boolean): RestSpotPlan | null {
  const floor = { id: `rest-floor:${context.environment.screenBounds.id}`, kind: 'screen_floor' as const,
    bounds: context.environment.screenBounds, isValidSupport: true };
  const current = context.environment.currentSurface;
  if (current === undefined || !current.isValidSupport || (current.kind !== 'screen_floor' && current.kind !== 'window_top')) return null;
  const surfaces = [...(context.externalSurfaces ?? []).filter(s => s.kind === 'window_top'),
    ...(current.kind === 'window_top' ? [current] : []), current.kind === 'screen_floor' ? current : floor];
  const candidates: ExplorePlan[] = [];
  for (const surface of surfaces) {
    const local = { ...context, environment: { ...context.environment, currentSurface: surface }, isReachable: undefined };
    candidates.push(...createExplorePlanCandidates(local, { ...DEFAULT_EXPLORE_PLANNER_CONFIG, minTargetDistancePx: 20, maxTargetDistancePx: 500 }));
    // A safe stationary rest must remain possible even when no distant target fits.
    if (surface.id === current.id) {
      candidates.push({ targetId: `${surface.id}:here`, surfaceId: surface.id, surfaceKind: surface.kind,
        targetRootPosition: context.currentRootPosition, pointKind: 'ordinary', routeKey: `${surface.id}:stay`,
        inspection: 'look_around', pose: 'none', choreographyKey: 'rest:stay', distancePx: 0,
        ...(isExternalSurface(surface) && surface.kind === 'window_top' ? { targetSurface: surface, supportLocalDistancePx: context.currentRootPosition.x - surface.bounds.x } : {}) });
    }
  }
  const ranked = scoreExplorePlans(candidates.map(plan => ({ ...plan, choreographyKey: `rest:${nap ? 'nap' : 'sleep'}` })), context).map(({ plan, weight }) => {
    const route = createExternalRoute(plan, context);
    const tier = plan.pointKind === 'edge' || plan.pointKind === 'corner' ? 2 : 1;
    return { plan, weight, tier, route };
  }).filter(item => item.route !== null).sort((a, b) => b.tier - a.tier || b.weight - a.weight || a.plan.targetId.localeCompare(b.plan.targetId));
  const best = ranked[0];
  if (best === undefined) return null;
  return { target: best.plan, nap, route: best.route! };
}

export function createRestSpotActivity(plan: RestSpotPlan): ActivityDefinition {
  const phase = (id: string, kind: 'lie_down' | 'sleep_loop' | 'wake_up', durationMs: number, next?: string): ActivityStep => ({
    id, actionId: `rest:${id}`, type: 'animation', stage: id === 'wake' ? 'exiting' : 'looping',
    intent: { kind, ...(id === 'sleep' ? { expressionHint: 'sleepy' as const, loop: 'until_replaced' as const } : {}) },
    completion: { type: 'elapsed', durationMs }, ...(next === undefined ? {} : { next }),
  });
  const steps: ActivityStep[] = [
    ...plan.route.map(s => s.next === 'inspect' ? { ...s, next: 'prepare' } : s),
    phase('prepare', 'lie_down', 1200, 'settle'),
    phase('settle', 'lie_down', 1500, 'sleep'),
    phase('sleep', 'sleep_loop', plan.nap ? 12_000 : 3000, plan.nap ? 'wake' : undefined),
  ];
  if (plan.nap) steps.push(phase('wake', 'wake_up', 1500));
  return { id: plan.nap ? 'rest_spot_nap' : 'rest_spot_sleep', priority: 'P4_autonomous', baseWeight: 1,
    entryStepId: steps[0]!.id, steps };
}
