import { calculateShyness } from './derived-traits';
import { PLAYFUL_PLAY_NEED_THRESHOLD, synthesizeEmotionalTone } from './emotional-tone';
import { requiresVitalSleep, WAKE_ATTENTION_MIN } from './autonomy-character-engine';
import { canExpressFlirt, DEFAULT_INTIMACY_THRESHOLDS } from './intimacy-rules';
import type { CharacterExpression, CharacterSnapshot, CharacterState } from './types';

export function projectCharacterExpression(snapshot: CharacterSnapshot): CharacterExpression {
  const friendship = snapshot.relationship.friendship;
  return {
    pace: requiresVitalSleep(snapshot) ? 'gentle' : 'normal',
    trust: friendship < DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD ? 'guarded'
      : friendship < DEFAULT_INTIMACY_THRESHOLDS.FRIENDSHIP_FLIRT_THRESHOLD ? 'familiar' : 'close',
    attention: snapshot.needs.attention >= WAKE_ATTENTION_MIN ? 'high' : 'ordinary',
    play: snapshot.needs.play >= PLAYFUL_PLAY_NEED_THRESHOLD ? 'high' : 'ordinary',
    romanceAllowed: canExpressFlirt(snapshot),
  };
}

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
