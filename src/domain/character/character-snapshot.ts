import { calculateShyness } from './derived-traits';
import { synthesizeEmotionalTone } from './emotional-tone';
import type { CharacterSnapshot, CharacterState } from './types';

export function createCharacterSnapshot(state: CharacterState): CharacterSnapshot {
  return {
    needs: { ...state.needs },
    relationship: { ...state.relationship },
    personality: {
      presetId: state.personality.id,
      aiSelfConcept: state.personality.aiSelfConcept,
      traits: {
        shyness: calculateShyness(state.personality.axes),
        playfulness: state.personality.axes.playfulness.current,
        sensitivity: state.personality.axes.sensitivity.current,
        boldness: state.personality.axes.boldness.current,
      },
    },
    intimacy: {
      flirtiness: state.intimacy.flirtiness,
      romanticCharge: state.intimacy.romanticCharge,
      userConsentEnabled: state.intimacy.userConsentEnabled,
    },
    synthesizedTone: synthesizeEmotionalTone(state),
  };
}
