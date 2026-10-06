import { calculateShyness } from './derived-traits';
import { DEFAULT_INTIMACY_THRESHOLDS } from './intimacy-rules';
import type { CharacterState, SynthesizedEmotionalTone } from './types';

const SHYNESS_TONE_THRESHOLD = 0.65;
const AFFECTIONATE_LOVE_THRESHOLD = 500;
const PLAYFUL_PLAY_NEED_THRESHOLD = 70;

export function synthesizeEmotionalTone(state: CharacterState): SynthesizedEmotionalTone {
  if (state.needs.energy <= 20 || state.needs.comfort >= 80) {
    return 'sleepy';
  }

  const shyness = calculateShyness(state.personality.axes);

  if (
    shyness >= SHYNESS_TONE_THRESHOLD &&
    state.relationship.friendship < DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD
  ) {
    return 'shy';
  }

  if (
    state.relationship.love >= AFFECTIONATE_LOVE_THRESHOLD &&
    state.relationship.friendship >= DEFAULT_INTIMACY_THRESHOLDS.FRIENDSHIP_FLIRT_THRESHOLD
  ) {
    return 'affectionate';
  }

  if (state.needs.play >= PLAYFUL_PLAY_NEED_THRESHOLD) {
    return 'playful';
  }

  return 'neutral';
}
