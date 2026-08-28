import { useEffect, useRef, useState } from 'react';
import type { AnimationIntent } from '../../domain/animation/animation-intent';
import { AnimationPlayer } from '../render-engine/animation-player';
import { AssetResolver } from '../render-engine/asset-resolver';
import type { AnimationLoopMode, ICharacterRenderer, RenderPresentationState } from '../render-engine/types';

/** Bridges an already-selected intent to render state; animation timing remains in AnimationPlayer. */
export function useCharacterAnimation(
  resolver: AssetResolver,
  intent: AnimationIntent
): RenderPresentationState | undefined {
  const [presentationState, setPresentationState] = useState<RenderPresentationState>();
  const publishedSignatureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const renderer: ICharacterRenderer = {
      render: (state: RenderPresentationState): void => {
        const signature = getPresentationSignature(state);
        if (publishedSignatureRef.current === signature) return;
        publishedSignatureRef.current = signature;
        setPresentationState(state);
      },
      destroy: (): void => undefined,
    };
    const player = new AnimationPlayer(renderer);
    player.play(resolver.resolve(intent), toPlayerLoopMode(intent.loop));

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
      player.destroy();
    };
  }, [intent, resolver]);

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
