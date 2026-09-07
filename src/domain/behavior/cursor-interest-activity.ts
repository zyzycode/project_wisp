import type { ActivityDefinition } from './activity-runner';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto } from './motion-engine';
import type { EnvironmentSnapshot } from './surface-kinematics';
/** One fixed reachable point on current support; samples never retarget a live episode. */
export function createCursorInterestActivity(input: {
  readonly root: Vector2Dto; readonly cursor: Vector2Dto; readonly environment: EnvironmentSnapshot;
  readonly collisionInsets: CollisionInsets; readonly maxDistance: number; readonly maxDurationMs: number;
}): ActivityDefinition | null {
  const { root, cursor, environment } = input;
  const surface = environment.currentSurface;
  if (!surface?.isValidSupport || (surface.kind !== 'screen_floor' && surface.kind !== 'window_top')
      || ![root.x, root.y, cursor.x, cursor.y].every(Number.isFinite)) return null;
  const range = calculateRootCollisionRange(environment.screenBounds, input.collisionInsets);
  const minX = Math.max(range.minX, surface.bounds.x);
  const maxX = Math.min(range.maxX, surface.bounds.x + surface.bounds.width);
  const supportY = surface.kind === 'screen_floor' ? range.maxY : surface.supportY ?? surface.bounds.y;
  if (Math.abs(root.y - supportY) > 2 || Math.abs(cursor.y - root.y) > 160 || minX >= maxX) return null;
  const x = Math.max(minX, Math.min(maxX, root.x + Math.max(-input.maxDistance, Math.min(input.maxDistance, cursor.x - root.x))));
  if (Math.abs(x - root.x) < 20) return null;
  return { id: 'cursor_interest', priority: 'P3_reactive', baseWeight: 1, cooldownKey: 'observe_cursor',
    tags: ['cursor'], entryStepId: 'notice', steps: [
      { id: 'notice', actionId: 'cursor_notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' },
        completion: { type: 'elapsed', durationMs: 600 }, next: 'approach' },
      { id: 'approach', actionId: 'cursor_approach', type: 'locomotion', stage: 'looping', gait: 'walk',
        targetRef: surface.id, targetRootPosition: { x, y: supportY },
        ...(surface.kind === 'window_top' ? { supportLocalDistancePx: x - surface.bounds.x } : {}),
        timeoutMs: input.maxDurationMs - 2200, intent: { kind: 'walk' }, next: 'play' },
      { id: 'play', actionId: 'cursor_play', type: 'animation', stage: 'looping', intent: { kind: 'cursor_play', expressionHint: 'happy' },
        completion: { type: 'elapsed', durationMs: 1000 }, next: 'settle' },
      { id: 'settle', actionId: 'cursor_settle', type: 'animation', stage: 'exiting', intent: { kind: 'settle' },
        completion: { type: 'elapsed', durationMs: 600 } },
    ] };
}
