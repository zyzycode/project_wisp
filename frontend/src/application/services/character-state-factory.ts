import type { CharacterState, Needs, PersonalityPreset } from '../../domain/character';
import { curiousStubbornGirlPreset } from '../../domain/character';
import { createRelationship } from '../../domain/character/relationship-facets';
import { emptyRepairCheckpoint } from '../../domain/character/relationship-repair';
import { emptyHabitMemory } from '../../domain/character/own-habit';

const DEFAULT_INITIAL_NEEDS: Needs = {
  energy: 85,
  attention: 35,
  play: 30,
  comfort: 20,
  boredom: 15,
};

function clonePersonalityPreset(preset: PersonalityPreset): PersonalityPreset {
  return {
    ...preset,
    axes: {
      openness: { ...preset.axes.openness },
      extraversion: { ...preset.axes.extraversion },
      agreeableness: { ...preset.axes.agreeableness },
      sensitivity: { ...preset.axes.sensitivity },
      playfulness: { ...preset.axes.playfulness },
      boldness: { ...preset.axes.boldness },
      independence: { ...preset.axes.independence },
    },
  };
}

export function cloneCharacterState(state: CharacterState): CharacterState {
  return {
    needs: { ...state.needs },
    relationship: { ...state.relationship },
    personality: clonePersonalityPreset(state.personality),
    intimacy: { ...state.intimacy },
    preferences: Object.fromEntries(
      Object.entries(state.preferences).map(([key, preference]) => [key, { ...preference }])
    ),
    ownHabitMemory: { ...state.ownHabitMemory, transitions: state.ownHabitMemory.transitions.map(t => ({ ...t })) },
    relationshipRepair: { ...state.relationshipRepair,
      lastInterruptionSource: state.relationshipRepair.lastInterruptionSource ? { ...state.relationshipRepair.lastInterruptionSource } : null,
      lastRepairSource: state.relationshipRepair.lastRepairSource ? { ...state.relationshipRepair.lastRepairSource } : null },
    ownBookInterestSources: state.ownBookInterestSources.map(source => ({ ...source })),
    ownGameInterestSources: state.ownGameInterestSources.map(source => ({ ...source })),
    lastUpdated: state.lastUpdated,
  };
}

export function createDefaultCharacterState(now: () => number): CharacterState {
  return {
    needs: { ...DEFAULT_INITIAL_NEEDS },
    relationship: createRelationship({
      friendship: 0,
      love: 0,
      loveUnlocked: false,
    }),
    personality: clonePersonalityPreset(curiousStubbornGirlPreset),
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: false,
      boundariesKnown: false,
    },
    preferences: {},
    ownHabitMemory: emptyHabitMemory(),
    relationshipRepair: emptyRepairCheckpoint(),
    ownBookInterestSources: [],
    ownGameInterestSources: [],
    lastUpdated: now(),
  };
}
