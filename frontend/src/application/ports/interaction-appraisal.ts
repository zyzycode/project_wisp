/** Target #87 semantic contracts; implementation is delivered by #89/#90. */
export interface CharacterCardReference {
  readonly id: 'shyDreamGirl';
  readonly revision: 1;
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
