import type { CharacterSnapshot, CharacterState } from './types';
import { DEFAULT_INTIMACY_THRESHOLDS } from './intimacy-rules';

export interface InteractionProposal {
  readonly category: 'supportive' | 'playful' | 'boundary' | 'hostile' | 'neutral';
  readonly intensity: 'low' | 'moderate';
  readonly confidence: 'clear' | 'uncertain';
}
export function interactionSignature(snapshot: CharacterSnapshot): string {
  const { needs, relationship, personality, intimacy } = snapshot;
  return JSON.stringify([personality.presetId, 1, snapshot.synthesizedTone,
    needs.energy <= 20 ? 0 : needs.energy < 30 ? 1 : 2,
    needs.comfort <= 60 ? 0 : needs.comfort < 80 ? 1 : 2,
    relationship.friendship < 400 ? 0 : relationship.friendship < 500 ? 1 : 2,
    relationship.loveUnlocked, intimacy.userConsentEnabled, personality.traits]);
}
export function isNonzeroProposal(proposal: InteractionProposal): boolean {
  return proposal.confidence === 'clear' && proposal.category !== 'neutral';
}
export function applyInteractionProposal(state: CharacterState, proposal: InteractionProposal): CharacterState {
  if (!isNonzeroProposal(proposal)) return state;
  const k = proposal.intensity === 'low' ? 1 : 2;
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const friendship = clamp(state.relationship.friendship + k * (proposal.category === 'supportive' ? 2 : proposal.category === 'playful' ? 1 : proposal.category === 'hostile' ? -1 : 0), 1000);
  return { ...state, needs: { ...state.needs,
    comfort: clamp(state.needs.comfort + k * (proposal.category === 'supportive' ? -1 : proposal.category === 'boundary' ? 1 : proposal.category === 'hostile' ? 2 : 0), 100),
    play: clamp(state.needs.play - (proposal.category === 'playful' ? 2 * k : 0), 100) },
    relationship: { ...state.relationship, friendship, loveUnlocked: state.relationship.loveUnlocked || (state.intimacy.userConsentEnabled && friendship >= DEFAULT_INTIMACY_THRESHOLDS.LOVE_UNLOCK_FRIENDSHIP_THRESHOLD) } };
}
