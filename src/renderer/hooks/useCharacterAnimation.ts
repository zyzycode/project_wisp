import { useEffect, useRef, useState } from 'react';
import type { AnimationIntent } from '../../domain/animation/animation-intent';
import { AnimationPlayer } from '../render-engine/animation-player';
import { AssetResolver } from '../render-engine/asset-resolver';
import type {
  AnimationCompletedEvent,
  AnimationLoopMode,
  ICharacterRenderer,
  RenderPresentationState,
  ResolvedAnimationClip,
} from '../render-engine/types';

/** Bridges an already-selected intent to render state; animation timing remains in AnimationPlayer. */
export function useCharacterAnimation(
  resolver: AssetResolver,
  intent: AnimationIntent,
  clipOverride?: ResolvedAnimationClip,
  playbackRequestId?: string,
  onCompleted?: (
    event: AnimationCompletedEvent,
    completedPlaybackRequestId: string | undefined
  ) => void,
  onRejected?: (rejectedPlaybackRequestId: string | undefined) => void
): RenderPresentationState | undefined {
  const [presentationState, setPresentationState] = useState<RenderPresentationState>();
  const publishedSignatureRef = useRef<string | undefined>(undefined);
  const playerRef = useRef<AnimationPlayer | null>(null);
  const previousPlaybackRequestIdRef = useRef<string | undefined>(undefined);
  const activePlaybackRequestIdRef = useRef<string | undefined>(undefined);
  const onCompletedRef = useRef(onCompleted);
  const onRejectedRef = useRef(onRejected);
  onCompletedRef.current = onCompleted;
  onRejectedRef.current = onRejected;

  useEffect(() => {
    if (!playerRef.current) {
      const renderer: ICharacterRenderer = {
        render: (state: RenderPresentationState): void => {
          const signature = getPresentationSignature(state);
          if (publishedSignatureRef.current === signature) return;
          publishedSignatureRef.current = signature;
          setPresentationState(state);
        },
        destroy: (): void => undefined,
      };
      playerRef.current = new AnimationPlayer(renderer);
      playerRef.current.onCompleted((event) => {
        onCompletedRef.current?.(event, activePlaybackRequestIdRef.current);
      });
    }

    const player = playerRef.current;
    try {
      const clip = clipOverride ?? resolver.resolve(intent);
      const loopMode = clipOverride === undefined
        ? toPlayerLoopMode(intent.loop)
        : { type: 'until_replaced' as const };
      if (
        playbackRequestId !== undefined &&
        playbackRequestId !== previousPlaybackRequestIdRef.current
      ) {
        player.play(clip, loopMode);
      } else {
        player.updateClip(clip, loopMode);
      }
    } catch {
      onRejectedRef.current?.(playbackRequestId);
      return undefined;
    }
    previousPlaybackRequestIdRef.current = playbackRequestId;
    activePlaybackRequestIdRef.current = playbackRequestId;

    let animationFrameId = 0;
    let previousNow: number | undefined;
    const tick = (now: number): void => {
      if (previousNow !== undefined) player.tick(now - previousNow);
      previousNow = now;
      animationFrameId = animationFrames.requestAnimationFrame(tick);
    };
    animationFrameId = animationFrames.requestAnimationFrame(tick);

    return (): void => {
      animationFrames.cancelAnimationFrame(animationFrameId);
    };
  }, [clipOverride, intent, playbackRequestId, resolver]);

  useEffect(() => {
    return (): void => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  return presentationState;
}

/** Stable signature of renderer-observable data; unchanged frames do not need a React render. */
export function getPresentationSignature(state: RenderPresentationState): string {
  return JSON.stringify({
    viewport: state.viewport,
    rootPivot: state.rootPivot,
    transform: state.transform,
    layers: state.layers.map((layer) => ({
      id: layer.id,
      category: layer.category,
      zIndex: layer.zIndex,
      pivot: layer.pivot,
      offset: layer.offset,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      visible: layer.visible,
      ...(layer.visible ? { frame: layer.frame } : {}),
    })),
    proceduralBlush: state.proceduralBlush,
  });
}

const animationFrames = globalThis as unknown as {
  requestAnimationFrame(callback: (now: number) => void): number;
  cancelAnimationFrame(id: number): void;
};

function toPlayerLoopMode(loop: AnimationIntent['loop']): AnimationLoopMode {
  if (loop === 'none') return { type: 'none' };
  if (loop === 'bounded') return { type: 'bounded', count: 1 };
  return { type: 'until_replaced' };
}
