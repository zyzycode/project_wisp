import { useEffect, useRef, useState } from 'react';
import {
  SpriteSkinAdapter,
  type AnimationCompletedEvent,
  type AssetResolver,
  type BodyVisualState,
  type ICharacterRenderer,
  type RenderPresentationState,
  type ResolvedAnimationClip,
} from '../render-engine';

/** React host for one SpriteSkinAdapter lifecycle. */
export function useCharacterAnimation(
  resolver: AssetResolver,
  visualState: Readonly<BodyVisualState>,
  clipOverride?: ResolvedAnimationClip,
  onCompleted?: (
    event: AnimationCompletedEvent,
    completedVisualEpisodeId: string | undefined
  ) => void,
  onRejected?: (rejectedVisualEpisodeId: string | undefined) => void
): RenderPresentationState | undefined {
  const [presentationState, setPresentationState] = useState<RenderPresentationState>();
  const adapterRef = useRef<SpriteSkinAdapter | null>(null);
  const visualStateRef = useRef(visualState);
  const onCompletedRef = useRef(onCompleted);
  const onRejectedRef = useRef(onRejected);
  visualStateRef.current = visualState;
  onCompletedRef.current = onCompleted;
  onRejectedRef.current = onRejected;

  useEffect(() => {
    const skinResolver: Pick<AssetResolver, 'resolve'> = clipOverride === undefined
      ? resolver
      : { resolve: () => clipOverride };
    const adapter = new SpriteSkinAdapter({
      resolver: skinResolver,
      createRenderer: (): ICharacterRenderer => ({
        render: setPresentationState,
        destroy: (): void => undefined,
      }),
      onCompleted: (event, episodeId) => onCompletedRef.current?.(event, episodeId),
      onRejected: (episodeId) => onRejectedRef.current?.(episodeId),
    });
    adapterRef.current = adapter;
    adapter.init();
    adapter.update(visualStateRef.current);
    return (): void => {
      adapter.destroy();
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, [clipOverride, resolver]);

  useEffect(() => {
    adapterRef.current?.update(visualState);
  }, [visualState]);

  return presentationState;
}
