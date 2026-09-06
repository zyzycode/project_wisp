import type { ActivityDefinition, ActivityStep } from './activity-runner';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto } from './motion-engine';
import type { EnvironmentSnapshot, ExternalWindowSurface, SurfaceSnapshotDto } from './surface-kinematics';

export const EXTERNAL_SURFACE_TTL_MS = 300;
export const WINDOW_TOP_SNAP_DISTANCE_PX = 12;

export function isExternalSurface(surface: SurfaceSnapshotDto | undefined): surface is ExternalWindowSurface {
  if (surface === undefined || !surface.isValidSupport || surface.id.length === 0) return false;
  const b = surface.bounds;
  if (![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return false;
  return surface.kind === 'window_top' ? surface.supportY === b.y && surface.side === undefined
    : surface.kind === 'window_side' && (surface.side === 'left' || surface.side === 'right') && surface.supportY === undefined;
}

export function isFreshExternalObservation(capturedAtMs: number, nowMs: number): boolean {
  const age = nowMs - capturedAtMs;
  return Number.isFinite(age) && age >= 0 && age <= EXTERNAL_SURFACE_TTL_MS;
}

export function isRootInsideEnvironment(root: Vector2Dto, environment: EnvironmentSnapshot, insets: CollisionInsets): boolean {
  try {
    const r = calculateRootCollisionRange(environment.screenBounds, insets);
    return Number.isFinite(root.x) && Number.isFinite(root.y)
      && root.x >= r.minX && root.x <= r.maxX && root.y >= r.minY && root.y <= r.maxY;
  } catch { return false; }
}

/** Only a user release selects a new external support; recovery never reattaches. */
export function selectWindowTopForRelease(
  surfaces: readonly ExternalWindowSurface[], root: Vector2Dto,
  environmentForPoint: (point: Vector2Dto) => EnvironmentSnapshot, insets: CollisionInsets,
): ExternalWindowSurface | null {
  return [...surfaces].filter(surface => isExternalSurface(surface) && surface.kind === 'window_top'
    && root.x >= surface.bounds.x && root.x <= surface.bounds.x + surface.bounds.width
    && Math.abs(root.y - surface.supportY) <= WINDOW_TOP_SNAP_DISTANCE_PX
    && isRootInsideEnvironment({ x: root.x, y: surface.supportY }, environmentForPoint({ x: root.x, y: surface.supportY }), insets))
    .sort((a, b) => Math.abs(root.y - a.bounds.y) - Math.abs(root.y - b.bounds.y) || a.id.localeCompare(b.id))[0] ?? null;
}

/** A bounded continuation of the user's selected support, not window discovery/selection. */
export function createWindowPerchActivity(surface: SurfaceSnapshotDto | undefined, root: Vector2Dto): ActivityDefinition | null {
  if (!isExternalSurface(surface) || surface.kind !== 'window_top') return null;
  const local = root.x - surface.bounds.x;
  const margin = Math.min(48, surface.bounds.width / 2);
  const target = Math.max(margin, Math.min(surface.bounds.width - margin, local));
  const walk = Math.abs(target - local) >= 1;
  const steps: ActivityStep[] = [
    { id: 'land', actionId: 'window_land', type: 'animation', stage: 'entering', intent: { kind: 'land' },
      completion: { type: 'elapsed', durationMs: 500 }, next: walk ? 'walk_support' : 'perch' },
  ];
  if (walk) steps.push({ id: 'walk_support', actionId: 'window_walk', type: 'locomotion', stage: 'looping',
    gait: 'walk', targetRef: surface.id, supportLocalDistancePx: target, intent: { kind: 'walk' }, timeoutMs: 2000, next: 'perch' });
  steps.push({ id: 'perch', actionId: 'sit_edge', type: 'animation', stage: 'looping', intent: { kind: 'sit_edge' },
    completion: { type: 'elapsed', durationMs: 3000 } });
  return { id: 'window_perch', priority: 'P1_user_interaction', baseWeight: 1, entryStepId: 'land', steps };
}
