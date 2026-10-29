import type { ActivityDefinition } from './activity-runner';
import { calculateRootCollisionRange, type CollisionInsets, type Vector2Dto } from './motion-engine';
import { isExternalSurface, isFreshExternalObservation } from './external-surface-support';
import type { EnvironmentSnapshot } from './surface-kinematics';

export interface ChatWalkPlanningInput {
  readonly direction: 'left' | 'right';
  readonly root: Vector2Dto;
  readonly environment: EnvironmentSnapshot;
  readonly collisionInsets: CollisionInsets;
  readonly nowMs: number;
}

export type ChatWalkPlan =
  | { readonly kind: 'planned'; readonly definition: ActivityDefinition; readonly supportId: string }
  | { readonly kind: 'rejected'; readonly reason: 'no_support' | 'edge' };

/** A voluntary walk stays on its current support; this never repairs a position. */
export function planChatWalk(input: ChatWalkPlanningInput): ChatWalkPlan {
  const { environment, root, direction } = input;
  const surface = environment.currentSurface;
  const noSupport: ChatWalkPlan = { kind: 'rejected', reason: 'no_support' };
  if (!surface?.isValidSupport || !surface.id.trim() || !Number.isFinite(input.nowMs)
      || ![root.x, root.y, surface.bounds.x, surface.bounds.y, surface.bounds.width, surface.bounds.height].every(Number.isFinite)
      || surface.bounds.width <= 0 || surface.bounds.height <= 0
      || (surface.kind !== 'screen_floor' && surface.kind !== 'window_top')) return noSupport;
  if (surface.kind === 'window_top' && (!isExternalSurface(surface)
      || !isFreshExternalObservation(environment.capturedAtMs, input.nowMs))) return noSupport;
  let range;
  try { range = calculateRootCollisionRange(environment.screenBounds, input.collisionInsets); }
  catch { return noSupport; }
  const minX = Math.max(range.minX, surface.bounds.x);
  const maxX = Math.min(range.maxX, surface.bounds.x + surface.bounds.width);
  const supportY = surface.kind === 'screen_floor' ? range.maxY : surface.bounds.y;
  if (root.x < minX || root.x > maxX || root.y < range.minY || root.y > range.maxY
      || Math.abs(root.y - supportY) > (surface.kind === 'screen_floor' ? 0.5 : 0.000001)) return noSupport;
  const targetX = direction === 'left' ? Math.max(minX, root.x - 160) : Math.min(maxX, root.x + 160);
  const distance = direction === 'left' ? root.x - targetX : targetX - root.x;
  if (distance <= 0) return { kind: 'rejected', reason: 'edge' };
  return {
    kind: 'planned', supportId: surface.id,
    definition: {
      id: 'chat_walk', priority: 'P1_user_interaction', baseWeight: 1, entryStepId: 'walk',
      steps: [{ id: 'walk', actionId: 'chat_walk', type: 'locomotion', stage: 'looping',
        gait: 'walk', targetRef: surface.id, targetRootPosition: { x: targetX, y: root.y },
        intent: { kind: 'walk', loop: 'until_replaced' }, timeoutMs: 7000 }],
    },
  };
}
