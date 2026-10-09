import type { NormalizedSpriteAnimationDef } from './types';

// Presentation cadence for the original four-frame, default-5-FPS artwork.
// Dedicated artist timing and traversal/cursor choreography remain authoritative.
const LEGACY_FRAME_DURATIONS: Readonly<Record<string, readonly number[]>> = {
  body_idle: [650, 550, 550, 650],
  body_thinking: [500, 600, 700, 600],
  body_look_around: [500, 650, 750, 500],
  body_crouch_examine: [300, 500, 900, 700],
  body_edge_peek: [300, 500, 900, 700],
  body_surface_touch: [300, 500, 900, 700],
  body_sleep_trans: [400, 650, 750, 600],
  body_sleep: [750, 750, 750, 750],
  body_lie: [400, 650, 750, 600],
  body_sit: [400, 650, 750, 600],
  body_bored: [650, 550, 550, 650],
  body_petting: [120, 180, 500, 400],
  body_wave: [120, 180, 500, 400],
  body_celebrate: [120, 180, 500, 400],
  body_scared: [120, 180, 500, 400],
};

const pacedAnimations = new WeakMap<NormalizedSpriteAnimationDef, {
  readonly scale: number; readonly animation: NormalizedSpriteAnimationDef;
}>();

/** Preserve frame identity across gaze/revision updates and never mutate manifest data. */
export function withClipPacing(animation: NormalizedSpriteAnimationDef, phaseDurationMs?: number): NormalizedSpriteAnimationDef {
  const durations = LEGACY_FRAME_DURATIONS[animation.key];
  if (durations === undefined || animation.frames.length !== durations.length ||
    animation.fps !== 5 || animation.frames.some(frame => frame.durationMs !== 200)) return animation;
  const duration = durations.reduce((total, value) => total + value, 0);
  const scale = phaseDurationMs !== undefined && Number.isFinite(phaseDurationMs) && phaseDurationMs > 0
    ? Math.min(1, phaseDurationMs * .9 / duration) : 1;
  const cached = pacedAnimations.get(animation);
  if (cached?.scale === scale) return cached.animation;
  const paced = { ...animation, frames: animation.frames.map((frame, index) => ({
    ...frame, durationMs: durations[index]! * scale,
  })) };
  // One latest budget per source keeps randomized phase durations from accumulating.
  pacedAnimations.set(animation, { scale, animation: paced });
  return paced;
}
