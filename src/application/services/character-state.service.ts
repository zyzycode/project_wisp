import {
  createCharacterSnapshot,
  processStimulus,
  shyDreamGirlPreset,
  synthesizeEmotionalTone,
} from '../../domain/character';
import type {
  CharacterSnapshot,
  CharacterState,
  CharacterStimulus,
  Needs,
  PersonalityPreset,
  SynthesizedEmotionalTone,
} from '../../domain/character';

const DEFAULT_INITIAL_NEEDS: Needs = {
  energy: 85,
  attention: 35,
  play: 30,
  comfort: 20,
  boredom: 15,
};

export interface CharacterStateServiceOptions {
  readonly initialState?: CharacterState;
  readonly now?: () => number;
}

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

function cloneCharacterState(state: CharacterState): CharacterState {
  return {
    needs: { ...state.needs },
    relationship: { ...state.relationship },
    personality: clonePersonalityPreset(state.personality),
    intimacy: { ...state.intimacy },
    preferences: Object.fromEntries(
      Object.entries(state.preferences).map(([key, preference]) => [key, { ...preference }])
    ),
    lastUpdated: state.lastUpdated,
  };
}

function createDefaultCharacterState(now: () => number): CharacterState {
  return {
    needs: { ...DEFAULT_INITIAL_NEEDS },
    relationship: {
      friendship: 0,
      love: 0,
      loveUnlocked: false,
    },
    personality: clonePersonalityPreset(shyDreamGirlPreset),
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: false,
      boundariesKnown: false,
    },
    preferences: {},
    lastUpdated: now(),
  };
}

function normalizeDeltaMs(deltaMs: number): number {
  return Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
}

export class CharacterStateService {
  private state: CharacterState;
  private readonly now: () => number;

  constructor(options: CharacterStateServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.state =
      options.initialState !== undefined
        ? cloneCharacterState(options.initialState)
        : createDefaultCharacterState(this.now);
  }

  public getState(): CharacterState {
    return cloneCharacterState(this.state);
  }

  public getSnapshot(): CharacterSnapshot {
    return createCharacterSnapshot(this.state);
  }

  public applyStimulus(stimulus: CharacterStimulus): CharacterState {
    this.state = processStimulus(this.state, stimulus);
    return this.getState();
  }

  public tickNeeds(deltaMs: number, tone?: SynthesizedEmotionalTone): CharacterState {
    const normalizedDeltaMs = normalizeDeltaMs(deltaMs);
    const metadata: CharacterStimulus['metadata'] = {
      deltaMs: normalizedDeltaMs,
    };

    if (tone !== undefined) {
      metadata.tone = tone;
    } else {
      metadata.tone = synthesizeEmotionalTone(this.state);
    }

    return this.applyStimulus({
      type: 'idle_tick',
      source: 'timer',
      createdAt: new Date(this.state.lastUpdated + normalizedDeltaMs).toISOString(),
      metadata,
    });
  }
}

export const defaultCharacterStateService = new CharacterStateService();
