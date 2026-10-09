import { createSystemAnimationIntent, type AnimationIntentKind } from '../../domain/animation/animation-intent';
import type { BodyVisualState } from './skin-engine';

/** Reserve a local revision between Body updates for completion or missing-art fallback. */
export function applyLocalTerminalState(
  state: Readonly<BodyVisualState>,
  kind: AnimationIntentKind | null
): BodyVisualState {
  if (kind === null) return { ...state, revision: state.revision * 2 };
  const intent = createSystemAnimationIntent(kind, state.visualIntent.emotionalTone);
  return {
    ...state,
    revision: state.revision * 2 + 1,
    visualAgeMs: 0,
    visualIntent: { ...state.visualIntent, ...intent,
      episodeId: `${state.visualIntent.episodeId}:local:${kind}` },
  };
}
