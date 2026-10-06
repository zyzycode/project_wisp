import type { CharacterState } from './types';

export interface IntimacyThresholds {
  readonly FRIENDSHIP_FLIRT_THRESHOLD: number;
  readonly MIN_FLIRT_ENERGY: number;
  readonly MAX_COMFORT_NEED: number;
  readonly LOVE_UNLOCK_FRIENDSHIP_THRESHOLD: number;
}

export const DEFAULT_INTIMACY_THRESHOLDS = {
  FRIENDSHIP_FLIRT_THRESHOLD: 500,
  MIN_FLIRT_ENERGY: 30,
  MAX_COMFORT_NEED: 60,
  LOVE_UNLOCK_FRIENDSHIP_THRESHOLD: 400,
} as const satisfies IntimacyThresholds;

export function canExpressFlirt(
  state: CharacterState,
  thresholds: IntimacyThresholds = DEFAULT_INTIMACY_THRESHOLDS
): boolean {
  return (
    state.intimacy.userConsentEnabled &&
    state.relationship.loveUnlocked &&
    state.relationship.friendship >= thresholds.FRIENDSHIP_FLIRT_THRESHOLD &&
    state.needs.energy >= thresholds.MIN_FLIRT_ENERGY &&
    state.needs.comfort <= thresholds.MAX_COMFORT_NEED
  );
}
