/**
 * Domain Contracts for Character Engine v2.
 *
 * Pure serializable TypeScript types only: no UI, IPC channel, Electron,
 * storage, provider SDK, DOM, React, CSS, animation asset, or platform details.
 */

import type { Needs } from './needs';
export type { Needs } from './needs';

export interface Relationship {
  /** 0-1000, baseline trust, comfort, and familiarity. */
  friendship: number;
  /** 0-1000, deeper emotional / romantic bond. */
  love: number;
  /** Love progression is gated until friendship and consent rules allow it. */
  loveUnlocked: boolean;
}

export type PersonalityAxis =
  | 'openness'
  | 'extraversion'
  | 'agreeableness'
  | 'sensitivity'
  | 'playfulness'
  | 'boldness'
  | 'independence';

export interface AxisValue {
  /** 0-1, identity anchor for the axis. */
  base: number;
  /** 0-1, current dynamic axis value. */
  current: number;
  /** 0-1, comfortable lower bound. */
  softMin: number;
  /** 0-1, comfortable upper bound. */
  softMax: number;
  /** 0-1, absolute lower bound. */
  hardMin: number;
  /** 0-1, absolute upper bound. */
  hardMax: number;
  /** 0-1, adaptation speed / ease for this axis. */
  plasticity: number;
}

export interface PersonalityPreset {
  id: string;
  displayName: string;
  aiSelfConcept: string;
  axes: Record<PersonalityAxis, AxisValue>;
}

export interface IntimacyState {
  /** 0-100, expressed flirt / coyness. */
  flirtiness: number;
  /** 0-100, internal romantic tension. */
  romanticCharge: number;
  /** User consent flag for romantic content. */
  userConsentEnabled: boolean;
  /** User boundaries have been established and are understandable. */
  boundariesKnown: boolean;
}

export type SynthesizedEmotionalTone =
  | 'shy'
  | 'sleepy'
  | 'playful'
  | 'curious'
  | 'neutral'
  | 'affectionate'
  | 'flustered';

export interface PreferenceTrack {
  /** -100..100, affinity score for a topic / genre / preference key. */
  value: number;
  /** 0-1, confidence in the score. */
  confidence: number;
  /** Number of observed interactions with this preference key. */
  samples: number;
}

export interface CharacterState {
  needs: Needs;
  relationship: Relationship;
  personality: PersonalityPreset;
  intimacy: IntimacyState;
  preferences: Record<string, PreferenceTrack>;
  lastUpdated: number;
}

export interface CharacterSnapshot {
  needs: Needs;
  relationship: Relationship;
  personality: {
    presetId: string;
    aiSelfConcept: string;
    traits: {
      shyness: number;
      playfulness: number;
      sensitivity: number;
      boldness: number;
    };
  };
  intimacy: Pick<IntimacyState, 'flirtiness' | 'romanticCharge' | 'userConsentEnabled'>;
  synthesizedTone: SynthesizedEmotionalTone;
}

export type StimulusType =
  | 'user_message'
  | 'user_click'
  | 'user_double_click'
  | 'user_right_click'
  | 'user_drag_start'
  | 'user_drag_end'
  | 'user_pet'
  | 'timer_tick'
  | 'autonomous_timer'
  | 'provider_response'
  | 'memory_recall'
  | 'settings_changed'
  | 'system_event';

export interface StimulusEvent {
  id: string;
  type: StimulusType;
  source: 'user' | 'provider' | 'timer' | 'memory' | 'settings' | 'system';
  createdAt: string;
  intensity?: number;
  text?: string;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CharacterPresentationDTO {
  needs: Needs;
  relationship: Relationship;
  intimacy: IntimacyState;
  synthesizedTone: SynthesizedEmotionalTone;
  personality: {
    presetId: string;
    displayName: string;
    traits: {
      shyness: number;
      playfulness: number;
      sensitivity: number;
      boldness: number;
    };
  };
  preferenceSummary: Array<{
    key: string;
    value: number;
    confidence: number;
  }>;
  lastUpdated: number;
}
