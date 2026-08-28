import {
  DEFAULT_SPRITE_FPS,
  type AnimationCompletedListener,
  type AnimationLoopMode,
  type IAnimationPlayer,
  type ICharacterRenderer,
  type RenderPresentationState,
  type RenderableFrameDef,
  type ResolvedAnimationClip,
  type ResolvedOverlayTrack,
  type ResolvedTrackBase,
  type SpritePoint,
  type TrackPlaybackMode,
  type VisibleRenderLayerDef,
} from './types';

const ZERO_POINT: SpritePoint = { x: 0, y: 0 };

/**
 * A passive, deterministic sprite player. The host drives it by calling tick
 * and receives presentation-only states through the renderer port.
 */
export class AnimationPlayer implements IAnimationPlayer {
  private readonly completedListeners = new Set<AnimationCompletedListener>();
  private clip: ResolvedAnimationClip | undefined;
  private loopMode: AnimationLoopMode | undefined;
  private elapsedMs = 0;
  private elapsedCompensationMs = 0;
  private completed = false;
  private destroyed = false;
  private presentationState: RenderPresentationState | undefined;

  constructor(private readonly renderer: ICharacterRenderer) {}

  play(clip: ResolvedAnimationClip, loopMode: AnimationLoopMode): void {
    if (this.destroyed) return;
    if (clip.body.frames.length === 0) {
      throw new Error('Resolved animation clips must contain at least one body frame.');
    }
    this.clip = clip;
    this.loopMode = normalizeLoopMode(loopMode);
    this.elapsedMs = 0;
    this.elapsedCompensationMs = 0;
    this.completed = false;
    this.emitPresentation();
  }

  tick(deltaMs: number): void {
    if (this.destroyed || this.clip === undefined || this.loopMode === undefined || this.completed || !isPositiveFinite(deltaMs)) {
      return;
    }

    const terminalElapsedMs = getTerminalElapsedMs(this.clip.body, this.loopMode);
    const nextElapsedMs = this.addElapsedMs(deltaMs);
    if (terminalElapsedMs !== undefined && nextElapsedMs >= terminalElapsedMs) {
      this.elapsedMs = terminalElapsedMs;
      this.completed = true;
      this.emitPresentation();
      this.notifyCompleted();
      return;
    }

    this.elapsedMs = nextElapsedMs;
    this.emitPresentation();
  }

  onCompleted(listener: AnimationCompletedListener): () => void {
    if (!this.destroyed) this.completedListeners.add(listener);
    return (): void => {
      this.completedListeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clip = undefined;
    this.loopMode = undefined;
    this.presentationState = undefined;
    this.completedListeners.clear();
  }

  getPresentationState(): RenderPresentationState | undefined {
    return this.presentationState;
  }

  private addElapsedMs(deltaMs: number): number {
    // Kahan summation keeps repeated fractional ticks aligned with frame boundaries.
    const correctedDeltaMs = deltaMs - this.elapsedCompensationMs;
    const nextElapsedMs = this.elapsedMs + correctedDeltaMs;
    this.elapsedCompensationMs = (nextElapsedMs - this.elapsedMs) - correctedDeltaMs;
    return nextElapsedMs;
  }

  private emitPresentation(): void {
    const clip = this.clip;
    const loopMode = this.loopMode;
    if (clip === undefined || loopMode === undefined) return;
    const layers: VisibleRenderLayerDef[] = [
      createLayer(clip.body, getBodyFrame(clip.body, this.elapsedMs, loopMode, this.completed)),
    ];
    appendOverlayLayer(layers, clip.face, this.elapsedMs);
    appendOverlayLayer(layers, clip.expression, this.elapsedMs);
    for (const prop of clip.props ?? []) appendOverlayLayer(layers, prop, this.elapsedMs);

    this.presentationState = {
      viewport: clip.viewport,
      rootPivot: clip.rootPivot,
      transform: clip.transform,
      layers,
      ...(clip.proceduralBlush === undefined ? {} : { proceduralBlush: clip.proceduralBlush }),
    };
    this.renderer.render(this.presentationState);
  }

  private notifyCompleted(): void {
    const clip = this.clip;
    const loopMode = this.loopMode;
    if (clip === undefined || loopMode === undefined) return;
    const loopCount = loopMode.type === 'bounded' ? loopMode.count : 1;
    const event = { clipKey: clip.key, loopCount, sessionElapsedMs: this.elapsedMs };
    for (const listener of this.completedListeners) listener(event);
  }
}

function normalizeLoopMode(loopMode: AnimationLoopMode): AnimationLoopMode {
  if (loopMode.type !== 'bounded') return loopMode;
  const count = Number.isFinite(loopMode.count) ? Math.max(1, Math.floor(loopMode.count)) : 1;
  return { type: 'bounded', count };
}

function getTerminalElapsedMs(track: ResolvedTrackBase, loopMode: AnimationLoopMode): number | undefined {
  if (loopMode.type === 'until_replaced') return undefined;
  const cycleDurationMs = getCycleDurationMs(track);
  return cycleDurationMs * (loopMode.type === 'bounded' ? loopMode.count : 1);
}

function getBodyFrame(
  track: ResolvedTrackBase,
  elapsedMs: number,
  loopMode: AnimationLoopMode,
  completed: boolean
): RenderableFrameDef {
  if (completed && loopMode.type !== 'until_replaced') return lastFrame(track);
  return getLoopFrame(track, elapsedMs);
}

function appendOverlayLayer(layers: VisibleRenderLayerDef[], track: ResolvedOverlayTrack | undefined, elapsedMs: number): void {
  if (track === undefined || track.frames.length === 0) return;
  const playbackMode = track.playbackMode ?? 'hold';
  const frame = getOverlayFrame(track, elapsedMs, playbackMode);
  if (frame !== undefined) layers.push(createLayer(track, frame));
}

function getOverlayFrame(
  track: ResolvedTrackBase,
  elapsedMs: number,
  playbackMode: TrackPlaybackMode
): RenderableFrameDef | undefined {
  const durationMs = getCycleDurationMs(track);
  if (playbackMode === 'once' && elapsedMs >= durationMs) return undefined;
  if (playbackMode === 'hold' && elapsedMs >= durationMs) return lastFrame(track);
  return playbackMode === 'loop' ? getLoopFrame(track, elapsedMs) : getFrameAtElapsed(track, elapsedMs);
}

function getLoopFrame(track: ResolvedTrackBase, elapsedMs: number): RenderableFrameDef {
  return getFrameAtElapsed(track, elapsedMs % getCycleDurationMs(track));
}

function getFrameAtElapsed(track: ResolvedTrackBase, elapsedMs: number): RenderableFrameDef {
  let remainingMs = elapsedMs;
  for (const frame of track.frames) {
    const durationMs = getFrameDurationMs(frame, track.fps);
    if (remainingMs < durationMs) return frame;
    remainingMs -= durationMs;
  }
  return lastFrame(track);
}

function getCycleDurationMs(track: ResolvedTrackBase): number {
  return track.frames.reduce((total, frame) => total + getFrameDurationMs(frame, track.fps), 0);
}

function getFrameDurationMs(frame: RenderableFrameDef, fps: number | undefined): number {
  return frame.durationMs ?? 1000 / (fps ?? DEFAULT_SPRITE_FPS);
}

function lastFrame(track: ResolvedTrackBase): RenderableFrameDef {
  const frame = track.frames[track.frames.length - 1];
  if (frame === undefined) throw new Error('Resolved tracks must contain at least one frame.');
  return frame;
}

function createLayer(track: ResolvedTrackBase, frame: RenderableFrameDef): VisibleRenderLayerDef {
  return {
    id: track.id,
    category: track.category,
    zIndex: track.zIndex,
    animationKey: track.animationKey,
    pivot: track.pivot ?? frame.pivot ?? ZERO_POINT,
    offset: track.offset ?? ZERO_POINT,
    opacity: track.opacity ?? 1,
    blendMode: track.blendMode ?? 'normal',
    visible: true,
    frame,
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
