import type { CharacterState } from './types';

/** Validates dynamic values without clamping or replaying stimuli during restore. */
export function validDynamicCharacterState(state: CharacterState): boolean {
  const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (![state.needs.energy, state.needs.attention, state.needs.play, state.needs.comfort, state.needs.boredom ?? 15].every(value => within(value, 0, 100))) return false;
  if (!within(state.relationship.friendship, 0, 1000) || !within(state.relationship.love, 0, 1000)) return false;
  if (!state.relationship.loveUnlocked && state.relationship.love > 0) return false;
  // loveUnlocked is a historical latch; revoking consent does not erase it.
  if (!within(state.intimacy.flirtiness, 0, 100) || !within(state.intimacy.romanticCharge, 0, 100)) return false;
  if (!Object.values(state.personality.axes).every(axis => within(axis.current, axis.hardMin, axis.hardMax))) return false;
  return Object.values(state.preferences).every(preference => within(preference.value, -100, 100) && within(preference.confidence, 0, 1) && Number.isSafeInteger(preference.samples) && preference.samples >= 0);
}
