/**
 * Domain Model: Interaction & Gesture Handling
 * Pure domain logic for user interactions: click gestures (single, double, long press),
 * affection / mood levels, and quick reaction triggers.
 */

export type InteractionType =
  | 'single_click'
  | 'double_click'
  | 'context_menu'
  | 'petting'
  | 'drag_start'
  | 'drag_end';

export interface PetAffectionState {
  affectionScore: number; // 0 to 100
  pettedCount: number;
  lastInteractedAt: number;
  /**
   * Current emotional mood of the pet.
   * Note: 'delighted', 'happy', and 'neutral' are derived automatically from affectionScore
   * during interactions and decay. 'sleepy' is assigned externally by behavioral state hooks
   * when transitioning to sleep/nap states.
   */
  mood: 'delighted' | 'happy' | 'neutral' | 'sleepy';
}

export const INITIAL_AFFECTION_STATE: PetAffectionState = {
  affectionScore: 50,
  pettedCount: 0,
  lastInteractedAt: Date.now(),
  mood: 'neutral',
};

/**
 * Calculates updated affection and mood state after a petting or click interaction.
 */
export function recordPetInteraction(
  currentState: PetAffectionState,
  interaction: InteractionType,
  timestamp: number = Date.now()
): PetAffectionState {
  let scoreDelta = 0;
  let newPettedCount = currentState.pettedCount;

  switch (interaction) {
    case 'petting':
    case 'single_click':
      scoreDelta = 4;
      newPettedCount += 1;
      break;
    case 'double_click':
      scoreDelta = 8;
      newPettedCount += 1;
      break;
    case 'drag_end':
      scoreDelta = 2;
      break;
    default:
      break;
  }

  const updatedScore = Math.max(0, Math.min(100, currentState.affectionScore + scoreDelta));

  let mood: PetAffectionState['mood'] = 'neutral';
  if (updatedScore >= 75) {
    mood = 'delighted';
  } else if (updatedScore >= 40) {
    mood = 'happy';
  } else {
    mood = 'neutral';
  }

  return {
    affectionScore: updatedScore,
    pettedCount: newPettedCount,
    lastInteractedAt: timestamp,
    mood,
  };
}

/**
 * Applies natural affection decay over time if pet was not interacted with.
 * Accurately advances lastInteractedAt by the accounted intervals to maintain linear decay.
 */
export function calculateAffectionDecay(
  currentState: PetAffectionState,
  currentTime: number = Date.now(),
  decayIntervalMs: number = 60000 // 1 minute
): PetAffectionState {
  const elapsed = currentTime - currentState.lastInteractedAt;
  if (elapsed < decayIntervalMs) {
    return currentState;
  }

  const intervals = Math.floor(elapsed / decayIntervalMs);
  const newScore = Math.max(10, currentState.affectionScore - intervals * 2);

  return {
    ...currentState,
    affectionScore: newScore,
    lastInteractedAt: currentState.lastInteractedAt + intervals * decayIntervalMs,
    mood: newScore >= 75 ? 'delighted' : newScore >= 40 ? 'happy' : 'neutral',
  };
}
