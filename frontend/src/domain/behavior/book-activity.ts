import type { ActivityDefinition } from './activity-runner';
import { BOOK_SESSION_TUNING } from './book-activity-policy';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto } from './motion-engine';
import { isExternalSurface, isFreshExternalObservation, isRootInsideEnvironment } from './external-surface-support';
import type { EnvironmentSnapshot } from './surface-kinematics';

export const BOOK_ACTIVITY: ActivityDefinition = {
  id: 'book', priority: 'P4_autonomous', baseWeight: 1, cooldownKey: 'book', entryStepId: 'settle',
  steps: [
    { id: 'settle', actionId: 'book:settle', stage: 'entering', type: 'animation', intent: { kind: 'book_settle', propHint: 'none' }, completion: { type: 'elapsed', durationMs: BOOK_SESSION_TUNING.settleMs }, next: 'with_book' },
    { id: 'with_book', actionId: 'book:with_book', stage: 'looping', type: 'animation', intent: { kind: 'book_with_book', propHint: 'book' }, completion: { type: 'elapsed', durationMs: BOOK_SESSION_TUNING.withBookMs }, next: 'finish' },
    { id: 'finish', actionId: 'book:finish', stage: 'exiting', type: 'animation', intent: { kind: 'book_finish', propHint: 'none' }, completion: { type: 'elapsed', durationMs: BOOK_SESSION_TUNING.finishMs } },
  ],
};

/** Stationary support only. Never search, snap, approach or attach to a different surface. */
export function hasBookSupport(environment: EnvironmentSnapshot, root: Vector2Dto, insets: CollisionInsets, nowMs: number): boolean {
  const surface = environment.currentSurface;
  if (!surface?.isValidSupport || !surface.id || !isFreshExternalObservation(environment.capturedAtMs, nowMs)
    || !isRootInsideEnvironment(root, environment, insets)) return false;
  const bounds = surface.bounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return false;
  if (surface.kind !== 'screen_floor' && (surface.kind !== 'window_top' || !isExternalSurface(surface))) return false;
  const limits = calculateRootCollisionRange(environment.screenBounds, insets);
  const y = surface.kind === 'screen_floor' ? limits.maxY : bounds.y;
  return root.x >= Math.max(limits.minX, bounds.x + insets.left)
    && root.x <= Math.min(limits.maxX, bounds.x + bounds.width - insets.right)
    && Math.abs(root.y - y) <= .01;
}
