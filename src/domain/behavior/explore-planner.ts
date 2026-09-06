import type { Needs, SynthesizedEmotionalTone } from '../character';
import type { ActivityDefinition } from './activity-runner';
import {
  calculateRootCollisionRange,
  type CollisionInsets,
  type Vector2Dto,
} from './motion-engine';
import type { EnvironmentSnapshot, SurfaceKind } from './surface-kinematics';

export type ExplorePointKind = 'ordinary' | 'corner' | 'edge' | 'interesting_surface';
export type ExploreInspectionKind =
  | 'look_around'
  | 'crouch_examine'
  | 'edge_peek'
  | 'surface_touch';
export type ExplorePose = 'none' | 'sit' | 'crouch' | 'lie';

export interface ExplorePlan {
  readonly targetId: string;
  readonly targetRootPosition: Vector2Dto;
  readonly pointKind: ExplorePointKind;
  readonly surfaceId: string;
  readonly surfaceKind: SurfaceKind;
  readonly routeKey: string;
  readonly inspection: ExploreInspectionKind;
  readonly pose: ExplorePose;
  readonly choreographyKey: string;
  readonly distancePx: number;
}

export interface ExploreHistoryEntry {
  readonly targetId: string;
  readonly routeKey: string;
  readonly choreographyKey: string;
  readonly selectedAtMs: number;
}

export interface ExploreHistory {
  readonly entries: readonly ExploreHistoryEntry[];
}

export interface ExplorePlannerConfig {
  readonly minTargetDistancePx: number;
  readonly maxTargetDistancePx: number;
  readonly edgeInsetPx: number;
  readonly historySize: number;
  readonly historyHalfLifeMs: number;
}

export const DEFAULT_EXPLORE_PLANNER_CONFIG: ExplorePlannerConfig = Object.freeze({
  minTargetDistancePx: 96,
  maxTargetDistancePx: 500,
  edgeInsetPx: 48,
  historySize: 12,
  historyHalfLifeMs: 300_000,
});

export interface ExplorePlanningContext {
  readonly currentRootPosition: Vector2Dto;
  readonly environment: EnvironmentSnapshot;
  readonly collisionInsets: CollisionInsets;
  readonly needs: Readonly<Needs>;
  readonly tone: SynthesizedEmotionalTone;
  readonly history: ExploreHistory;
  readonly nowMs: number;
}

export interface ScoredExplorePlan {
  readonly plan: ExplorePlan;
  readonly distanceScore: number;
  readonly surfaceScore: number;
  readonly stateScore: number;
  readonly repetitionScore: number;
  readonly weight: number;
}

interface ExplorePointSeed {
  readonly kind: ExplorePointKind;
  readonly x: number;
}

function unit(value: number | undefined): number {
  return Math.max(0, Math.min(1, (value ?? 0) / 100));
}

function inspectionFor(pointKind: ExplorePointKind): ExploreInspectionKind {
  if (pointKind === 'corner') return 'crouch_examine';
  if (pointKind === 'edge') return 'edge_peek';
  if (pointKind === 'interesting_surface') return 'surface_touch';
  return 'look_around';
}

export function isExplorePoseCompatible(
  pose: ExplorePose,
  surfaceKind: SurfaceKind
): boolean {
  if (pose === 'none') return true;
  if (surfaceKind === 'unknown') return false;
  if (pose === 'lie') return surfaceKind === 'screen_floor';
  return surfaceKind === 'screen_floor' || surfaceKind === 'window_top';
}

function poseFor(
  pointKind: ExplorePointKind,
  surfaceKind: SurfaceKind,
  needs: Readonly<Needs>,
  tone: SynthesizedEmotionalTone
): ExplorePose {
  const preferred: ExplorePose = pointKind === 'corner'
    ? 'crouch'
    : needs.energy <= 40 || needs.comfort >= 75
      ? 'lie'
      : pointKind === 'edge'
        ? 'sit'
        : tone === 'curious' || unit(needs.boredom) >= 0.7
          ? 'crouch'
          : needs.energy < 65
            ? 'sit'
            : 'none';
  return isExplorePoseCompatible(preferred, surfaceKind) ? preferred : 'none';
}

function pointSeeds(minX: number, maxX: number, currentX: number, config: ExplorePlannerConfig): readonly ExplorePointSeed[] {
  const span = maxX - minX;
  const edgeInset = Math.min(config.edgeInsetPx, span / 4);
  return [
    { kind: 'corner', x: minX },
    { kind: 'edge', x: minX + edgeInset },
    { kind: 'ordinary', x: minX + span * 0.3 },
    { kind: 'interesting_surface', x: minX + span * 0.35 },
    { kind: 'interesting_surface', x: minX + span * 0.65 },
    { kind: 'ordinary', x: minX + span * 0.7 },
    { kind: 'edge', x: maxX - edgeInset },
    { kind: 'corner', x: maxX },
    { kind: 'ordinary', x: Math.max(minX, currentX - config.maxTargetDistancePx) },
    { kind: 'ordinary', x: Math.min(maxX, currentX + config.maxTargetDistancePx) },
  ];
}

export function createExplorePlanCandidates(
  context: ExplorePlanningContext,
  config: ExplorePlannerConfig = DEFAULT_EXPLORE_PLANNER_CONFIG
): readonly ExplorePlan[] {
  const surface = context.environment.currentSurface;
  if (surface === undefined || !surface.isValidSupport) return [];
  let collisionRange;
  try {
    collisionRange = calculateRootCollisionRange(
      context.environment.screenBounds,
      context.collisionInsets
    );
  } catch {
    return [];
  }
  const minX = Math.max(collisionRange.minX, surface.bounds.x);
  const maxX = Math.min(collisionRange.maxX, surface.bounds.x + surface.bounds.width);
  if (minX >= maxX) return [];
  const maximumDistance = Math.min(config.maxTargetDistancePx, maxX - minX);
  const minimumDistance = Math.min(
    config.minTargetDistancePx,
    maximumDistance * 0.5,
    (maxX - minX) * 0.25
  );
  if (minimumDistance < 20) return [];
  const targetY = surface.kind === 'screen_floor'
    ? collisionRange.maxY
    : context.currentRootPosition.y;
  const seen = new Set<string>();
  const plans: ExplorePlan[] = [];
  for (const seed of pointSeeds(minX, maxX, context.currentRootPosition.x, config)) {
    const x = Math.round(seed.x * 1000) / 1000;
    const distancePx = Math.abs(x - context.currentRootPosition.x);
    if (distancePx < minimumDistance || distancePx > maximumDistance) continue;
    const key = `${x}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const direction = x < context.currentRootPosition.x ? 'left' : 'right';
    const routeKey = `${surface.id}:${direction}:${Math.round(distancePx / 100)}`;
    const inspection = inspectionFor(seed.kind);
    const pose = poseFor(seed.kind, surface.kind, context.needs, context.tone);
    plans.push(Object.freeze({
      targetId: `${surface.id}:${x}`,
      targetRootPosition: { x, y: targetY },
      pointKind: seed.kind,
      surfaceId: surface.id,
      surfaceKind: surface.kind,
      routeKey,
      inspection,
      pose,
      choreographyKey: `${inspection}:${pose}`,
      distancePx,
    }));
  }
  return plans;
}

function repetitionScore(plan: ExplorePlan, context: ExplorePlanningContext, config: ExplorePlannerConfig): number {
  let target = 0;
  let route = 0;
  let choreography = 0;
  for (const entry of context.history.entries) {
    const decay = Math.exp(
      -Math.LN2 * Math.max(0, context.nowMs - entry.selectedAtMs) / config.historyHalfLifeMs
    );
    if (entry.targetId === plan.targetId) target += decay;
    if (entry.routeKey === plan.routeKey) route += decay;
    if (entry.choreographyKey === plan.choreographyKey) choreography += decay;
  }
  const rawPenalty = Math.max(0.08, Math.exp(-1.4 * target - 0.9 * route - 0.6 * choreography));
  const needStrength = Math.min(1, unit(context.needs.boredom) * 0.6 + unit(context.needs.play) * 0.25 + unit(context.needs.energy) * 0.15);
  return rawPenalty + needStrength * (1 - rawPenalty);
}

function stateScore(plan: ExplorePlan, needs: Readonly<Needs>): number {
  if (plan.pose === 'lie') return needs.energy <= 40 || needs.comfort >= 75 ? 1.25 : 0.75;
  if (plan.pose === 'sit') return needs.energy < 65 ? 1.15 : 0.9;
  if (plan.pose === 'crouch') return unit(needs.boredom) >= 0.7 ? 1.2 : 1;
  return needs.energy >= 60 ? 1.1 : 0.85;
}

export function scoreExplorePlans(
  plans: readonly ExplorePlan[],
  context: ExplorePlanningContext,
  config: ExplorePlannerConfig = DEFAULT_EXPLORE_PLANNER_CONFIG
): readonly ScoredExplorePlan[] {
  return plans.map((plan) => {
    const distanceScore = 0.55 + 0.45 * Math.min(1, plan.distancePx / config.maxTargetDistancePx);
    const surfaceScore = (plan.surfaceKind === 'window_top' ? 1.15 : plan.surfaceKind === 'screen_floor' ? 1 : 0.65)
      * (plan.pointKind === 'interesting_surface' ? 1.15 : plan.pointKind === 'corner' ? 1.08 : 1);
    const planStateScore = stateScore(plan, context.needs);
    const planRepetitionScore = repetitionScore(plan, context, config);
    return Object.freeze({
      plan,
      distanceScore,
      surfaceScore,
      stateScore: planStateScore,
      repetitionScore: planRepetitionScore,
      weight: distanceScore * surfaceScore * planStateScore * planRepetitionScore,
    });
  });
}

export function selectExplorePlan(
  context: ExplorePlanningContext,
  randomUnit: number,
  config: ExplorePlannerConfig = DEFAULT_EXPLORE_PLANNER_CONFIG
): ExplorePlan | null {
  if (!Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit >= 1) {
    throw new RangeError('Explore randomUnit must be finite and in [0, 1)');
  }
  const scored = scoreExplorePlans(createExplorePlanCandidates(context, config), context, config)
    .filter((candidate) => candidate.weight > 0);
  const total = scored.reduce((sum, candidate) => sum + candidate.weight, 0);
  if (total <= 0) return null;
  let cursor = randomUnit * total;
  for (const candidate of scored) {
    cursor -= candidate.weight;
    if (cursor <= 0) return candidate.plan;
  }
  return scored.at(-1)?.plan ?? null;
}

export function recordExplorePlan(
  history: ExploreHistory,
  plan: ExplorePlan,
  selectedAtMs: number,
  config: ExplorePlannerConfig = DEFAULT_EXPLORE_PLANNER_CONFIG
): ExploreHistory {
  return {
    entries: [...history.entries, {
      targetId: plan.targetId,
      routeKey: plan.routeKey,
      choreographyKey: plan.choreographyKey,
      selectedAtMs,
    }].slice(-config.historySize),
  };
}

export function createExploreActivityDefinition(plan: ExplorePlan, route: readonly ActivityDefinition['steps'][number][] = []): ActivityDefinition {
  const inspectNext = plan.pose === 'none'
    ? undefined
    : plan.pose === 'crouch' && plan.inspection === 'crouch_examine'
      ? 'leave_pose'
      : 'pose';
  const poseIntent = plan.pose === 'sit'
    ? 'sit'
    : plan.pose === 'lie'
      ? 'lie_down'
      : 'crouch_examine';
  const leavePoseIntent = plan.pose === 'lie' ? 'get_up' : 'stand_up';
  const steps: ActivityDefinition['steps'][number][] = [
    {
      id: 'walk', actionId: `walk:${plan.routeKey}`, stage: 'entering', type: 'locomotion',
      gait: 'walk', targetRef: plan.targetId, intent: { kind: 'walk' }, timeoutMs: 7_000,
      next: 'inspect',
    },
    {
      id: 'inspect', actionId: plan.inspection, stage: 'looping', type: 'animation',
      intent: { kind: plan.inspection, expressionHint: 'curious' },
      completion: { type: 'elapsed', durationMs: 2_200 },
      ...(inspectNext === undefined ? {} : { next: inspectNext }),
    },
  ];
  if (plan.pose !== 'none' && inspectNext === 'pose') {
    steps.push({
      id: 'pose', actionId: `pose:${plan.pose}`, stage: 'looping', type: 'animation',
      intent: { kind: poseIntent }, completion: { type: 'elapsed', durationMs: 3_000 },
      next: 'leave_pose',
    });
  }
  if (plan.pose !== 'none') {
    steps.push({
      id: 'leave_pose', actionId: `leave:${plan.pose}`, stage: 'exiting', type: 'animation',
      intent: { kind: leavePoseIntent }, completion: { type: 'elapsed', durationMs: 1_500 },
    });
  }
  return Object.freeze({
    id: 'explore',
    priority: 'P4_autonomous',
    baseWeight: 1,
    entryStepId: route[0]?.id ?? 'walk',
    steps: Object.freeze(route.length === 0 ? steps : [...route, ...steps.slice(1)]),
    tags: Object.freeze([plan.pointKind, plan.surfaceKind, plan.choreographyKey]),
  });
}

export const DEFAULT_EXPLORE_PLAN: ExplorePlan = Object.freeze({
  targetId: 'wander_target',
  targetRootPosition: { x: 0, y: 0 },
  pointKind: 'ordinary',
  surfaceId: 'screen_floor',
  surfaceKind: 'screen_floor',
  routeKey: 'default',
  inspection: 'look_around',
  pose: 'none',
  choreographyKey: 'look_around:none',
  distancePx: DEFAULT_EXPLORE_PLANNER_CONFIG.minTargetDistancePx,
});
