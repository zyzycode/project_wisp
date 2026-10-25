/** Target #87 semantic contracts; implementation is delivered by #89/#90. */
export interface CharacterCardReference {
  readonly id: 'curiousStubbornGirl';
  readonly revision: 2;
}

/** A proposal about this interaction, never a user fact or numeric write. */
export interface InteractionAppraisal {
  readonly category: 'supportive' | 'playful' | 'boundary' | 'hostile' | 'neutral';
  readonly intensity: 'low' | 'moderate';
  readonly confidence: 'clear' | 'uncertain';
}

/** One published touch reaction; volatile, bounded, and never a synthetic chat turn. */
export interface PreviousTouchReaction {
  readonly action: 'touch';
  readonly occurredAt: string;
  readonly publishedText: string;
  readonly appraisal: InteractionAppraisal;
  readonly effect: 'accepted' | 'neutral' | 'suppressed' | 'rejected';
  readonly reason: 'applied' | 'uncertain' | 'cooldown' | 'state_changed' | 'unavailable' | 'neutral';
  readonly energyBand: 'tired' | 'rested';
  readonly comfortBand: 'overloaded' | 'calm';
}

/** Local once-only admission receipt; never serialized to provider or Renderer. */
export interface InteractionReceipt {
  readonly sequence: number; readonly generation: number; readonly signature: string;
  readonly effectPolicy: 'eligible' | 'suppressed';
}
export interface TouchInteractionReceipt extends InteractionReceipt {
  readonly energyBand: 'tired' | 'rested'; readonly comfortBand: 'calm' | 'overloaded';
}
