import type { BodyVisualState } from './skin-engine';
import type { ResolvedAnimationClip } from './types';

// Nominal world-pixel speeds for existing walk/run/climb artwork. Presentation
// advances with distance travelled; it never changes authoritative motion.
const REFERENCE_SPEED: Readonly<Partial<Record<BodyVisualState['visualIntent']['kind'], number>>> = {
  walk: 90, run: 180, crawl: 45, climb_wall: 220, hang_ceiling: 90,
};

export function locomotionPlaybackRate(state: Readonly<BodyVisualState> | null): number {
  if (state === null || state.visualIntent.loop !== 'until_replaced') return 1;
  const velocity = state.motionVelocityPxPerSec;
  const reference = REFERENCE_SPEED[state.visualIntent.kind];
  if (velocity === undefined || reference === undefined) return 1;
  const speed = Math.hypot(velocity.x, velocity.y);
  return Number.isFinite(speed) ? Math.min(3, speed / reference) : 1;
}

/** Existing planted walk pose; run uses neutral idle because its last frame is airborne. */
export function withStoppedLocomotionPose(
  clip: ResolvedAnimationClip,
  state: Readonly<BodyVisualState>,
  resolveIdle: () => ResolvedAnimationClip
): ResolvedAnimationClip {
  const kind = state.visualIntent.kind;
  if ((kind !== 'walk' && kind !== 'run') || locomotionPlaybackRate(state) !== 0) return clip;
  const stopped = kind === 'walk' ? clip : resolveIdle();
  const index = stopped.body.frames.length - 1;
  const frame = stopped.body.frames[index];
  if (frame === undefined) return clip;
  return { ...stopped, key: clip.key, body: { ...stopped.body, frames: [frame],
    frameMeta: stopped.body.frameMeta?.slice(index, index + 1) } };
}

export function spriteFacingFlipX(animationKey: string | undefined, requestedFlipX: boolean): boolean {
  const nativeRight = animationKey === 'body_run' || animationKey?.startsWith('body_run_') === true;
  return nativeRight ? !requestedFlipX : requestedFlipX;
}
