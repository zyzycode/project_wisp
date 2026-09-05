import type { AnimationIntent } from '../../domain/animation/animation-intent';
import type { BrainVisualIntentDTO } from '../../shared/ipc-contracts';
import { AnimationPlayer } from './animation-player';
import { AssetResolver } from './asset-resolver';
import type { BodyVisualReflexState, BodyVisualState, ISkinEngine } from './skin-engine';
import type {
  AnimationCompletedEvent,
  AnimationLoopMode,
  ICharacterRenderer,
  RenderLayerDef,
  RenderPresentationState,
  SpritePoint,
} from './types';

export interface SkinAnimationFrameScheduler {
  request(callback: (now: number) => void): number;
  cancel(frameId: number): void;
}

export interface SpriteSkinAdapterOptions {
  readonly resolver: Pick<AssetResolver, 'resolve'>;
  readonly createRenderer: () => ICharacterRenderer;
  readonly scheduler?: SkinAnimationFrameScheduler;
  readonly onCompleted?: (
    event: AnimationCompletedEvent,
    completedEpisodeId: string | undefined
  ) => void;
  readonly onRejected?: (rejectedEpisodeId: string | undefined) => void;
}

/**
 * Suppresses player emissions that resolve to the same visible frame without
 * serializing the render tree. A monotonically increasing local revision is
 * assigned only to states forwarded to the concrete renderer.
 */
export class PresentationRevisionPublisher implements ICharacterRenderer {
  private previous: RenderPresentationState | undefined;
  private revision = 0;
  private destroyed = false;

  public constructor(private readonly renderer: ICharacterRenderer) {}

  public render(state: RenderPresentationState): void {
    if (this.destroyed || isSamePresentationFrame(this.previous, state)) return;
    this.previous = state;
    this.revision += 1;
    this.renderer.render(state);
  }

  public preload(sources: readonly string[]): Promise<void> {
    return this.renderer.preload?.(sources) ?? Promise.resolve();
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.previous = undefined;
    this.renderer.destroy();
  }

  public getRevision(): number {
    return this.revision;
  }
}

/** The sole current Skin adapter: semantic Body projection to sprite frames. */
export class SpriteSkinAdapter implements ISkinEngine {
  private readonly scheduler: SkinAnimationFrameScheduler;
  private initialized = false;
  private destroyed = false;
  private player: AnimationPlayer | null = null;
  private renderer: PresentationRevisionPublisher | null = null;
  private unsubscribeCompleted: (() => void) | null = null;
  private frameId: number | null = null;
  private previousFrameNow: number | undefined;
  private currentState: Readonly<BodyVisualState> | null = null;
  private activeEpisodeKey: string | null = null;

  public constructor(private readonly options: SpriteSkinAdapterOptions) {
    this.scheduler = options.scheduler ?? browserAnimationFrameScheduler;
  }

  public init(): void {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    this.createLifecycle();
  }

  public update(state: Readonly<BodyVisualState>): void {
    if (!this.initialized || this.destroyed) return;
    const current = this.currentState;
    if (current !== null && current.streamId === state.streamId && state.revision <= current.revision) {
      return;
    }
    if (current !== null && current.streamId !== state.streamId) {
      this.teardownLifecycle();
      this.createLifecycle();
      this.activeEpisodeKey = null;
    }

    this.currentState = state;
    const episodeKey = `${state.streamId}\u0000${state.visualIntent.episodeId}`;
    try {
      const clip = this.options.resolver.resolve(toAnimationIntent(state));
      const loopMode = toPlayerLoopMode(state.visualIntent.loop);
      if (episodeKey !== this.activeEpisodeKey) {
        this.activeEpisodeKey = episodeKey;
        this.player?.play(clip, loopMode, state.visualAgeMs);
      } else {
        this.player?.updateClip(clip, loopMode);
      }
    } catch {
      this.options.onRejected?.(state.visualIntent.episodeId);
    }
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardownLifecycle();
    this.currentState = null;
    this.activeEpisodeKey = null;
  }

  private createLifecycle(): void {
    const concreteRenderer = this.options.createRenderer();
    this.renderer = new PresentationRevisionPublisher(concreteRenderer);
    const playerRenderer: ICharacterRenderer = {
      render: (state) => {
        const visualState = this.currentState;
        if (visualState !== null) {
          this.renderer?.render(applyBodyReflex(state, visualState.reflex));
        }
      },
      destroy: (): void => undefined,
    };
    this.player = new AnimationPlayer(playerRenderer);
    this.unsubscribeCompleted = this.player.onCompleted((event) => {
      this.options.onCompleted?.(event, this.currentState?.visualIntent.episodeId);
    });
    this.previousFrameNow = undefined;
    this.frameId = this.scheduler.request((now) => this.tick(now));
  }

  private teardownLifecycle(): void {
    if (this.frameId !== null) this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.previousFrameNow = undefined;
    this.unsubscribeCompleted?.();
    this.unsubscribeCompleted = null;
    this.player?.destroy();
    this.player = null;
    this.renderer?.destroy();
    this.renderer = null;
  }

  private tick(now: number): void {
    if (this.destroyed || this.player === null) return;
    if (this.previousFrameNow !== undefined) this.player.tick(now - this.previousFrameNow);
    this.previousFrameNow = now;
    this.frameId = this.scheduler.request((nextNow) => this.tick(nextNow));
  }
}

function toAnimationIntent(
  state: Readonly<BodyVisualState>
): AnimationIntent<BrainVisualIntentDTO['kind']> {
  const visualIntent = state.visualIntent;
  const preservesSemanticExpression =
    visualIntent.expressionHint !== undefined && visualIntent.expressionHint !== 'idle';
  return {
    kind: visualIntent.kind,
    category: visualIntent.category,
    priority: visualIntent.priority,
    interrupt: visualIntent.interrupt,
    loop: visualIntent.loop,
    requestedBy: 'brain',
    emotionalTone: visualIntent.emotionalTone,
    ...(preservesSemanticExpression
      ? { expressionHint: visualIntent.expressionHint }
      : {
          expressionHint: 'gaze' as const,
          gazeDirection: gazeDirectionFor(state.reflex.pupilOffset),
        }),
    ...(preservesSemanticExpression && visualIntent.gazeDirection !== undefined
      ? { gazeDirection: visualIntent.gazeDirection }
      : {}),
    ...(visualIntent.propHint === undefined ? {} : { propHint: visualIntent.propHint }),
  };
}

function gazeDirectionFor(offset: Readonly<SpritePoint>): NonNullable<AnimationIntent['gazeDirection']> {
  if (Math.abs(offset.x) >= Math.abs(offset.y) && offset.x !== 0) {
    return offset.x < 0 ? 'left' : 'right';
  }
  return offset.y < 0 ? 'up' : 'down';
}

function toPlayerLoopMode(loop: BodyVisualState['visualIntent']['loop']): AnimationLoopMode {
  if (loop === 'none') return { type: 'none' };
  if (loop === 'bounded') return { type: 'bounded', count: 1 };
  return { type: 'until_replaced' };
}

function applyBodyReflex(
  state: RenderPresentationState,
  reflex: Readonly<BodyVisualReflexState>
): RenderPresentationState {
  return {
    ...state,
    transform: {
      ...state.transform,
      flipX: reflex.transform.flipX,
      scaleX: reflex.transform.scaleX,
      scaleY: reflex.transform.scaleY,
      rotationDeg: reflex.transform.rotationDeg,
    },
  };
}

function isSamePresentationFrame(
  previous: RenderPresentationState | undefined,
  next: RenderPresentationState
): boolean {
  if (previous === undefined) return false;
  if (
    !samePoint(previous.viewport, next.viewport) ||
    !samePoint(previous.rootPivot, next.rootPivot) ||
    previous.transform.flipX !== next.transform.flipX ||
    previous.transform.scale !== next.transform.scale ||
    (previous.transform.scaleX ?? 1) !== (next.transform.scaleX ?? 1) ||
    (previous.transform.scaleY ?? 1) !== (next.transform.scaleY ?? 1) ||
    (previous.transform.rotationDeg ?? 0) !== (next.transform.rotationDeg ?? 0) ||
    previous.layers.length !== next.layers.length ||
    !sameBlush(previous, next)
  ) return false;
  return previous.layers.every((layer, index) => sameLayer(layer, next.layers[index]));
}

function sameLayer(left: RenderLayerDef, right: RenderLayerDef | undefined): boolean {
  if (
    right === undefined ||
    left.id !== right.id ||
    left.category !== right.category ||
    left.zIndex !== right.zIndex ||
    left.animationKey !== right.animationKey ||
    !samePoint(left.pivot, right.pivot) ||
    !samePoint(left.offset, right.offset) ||
    left.opacity !== right.opacity ||
    left.blendMode !== right.blendMode ||
    left.visible !== right.visible
  ) return false;
  if (!left.visible || !right.visible) return true;
  return left.frame === right.frame;
}

function sameBlush(left: RenderPresentationState, right: RenderPresentationState): boolean {
  const a = left.proceduralBlush;
  const b = right.proceduralBlush;
  if (a === undefined || b === undefined) return a === b;
  return a.id === b.id &&
    a.intensity === b.intensity &&
    a.blendMode === b.blendMode &&
    a.color === b.color &&
    samePoint(a.leftCheek, b.leftCheek) &&
    samePoint(a.rightCheek, b.rightCheek) &&
    a.radius === b.radius &&
    a.opacity === b.opacity;
}

function samePoint(
  left: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number },
  right: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number }
): boolean {
  return left.x === right.x && left.y === right.y &&
    left.width === right.width && left.height === right.height;
}

const browserAnimationFrameScheduler: SkinAnimationFrameScheduler = {
  request: (callback) => animationFrames.requestAnimationFrame(callback),
  cancel: (frameId) => animationFrames.cancelAnimationFrame(frameId),
};

const animationFrames = globalThis as unknown as {
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(frameId: number): void;
};
