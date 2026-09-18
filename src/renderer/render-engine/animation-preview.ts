import type { BodyVisualState } from './skin-engine';

export interface DebugAnimationSelection {
  readonly bodyKey: string;
  readonly faceKey?: string;
  readonly replayToken?: number;
  readonly loop?: boolean;
}

/** A Skin-only playback clock: Brain revisions cannot seek or replace the preview. */
export function createAnimationPreviewState(
  state: Readonly<BodyVisualState>,
  selection: DebugAnimationSelection
): BodyVisualState {
  return {
    ...state,
    visualAgeMs: 0,
    visualIntent: {
      ...state.visualIntent,
      episodeId: `preview:${selection.bodyKey}:${selection.faceKey ?? ''}:${selection.replayToken ?? 0}`,
      episodeStartedAtMs: 0,
      loop: selection.loop === false ? 'none' : 'until_replaced',
    },
  };
}
