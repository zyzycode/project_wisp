import type { ICharacterPreferenceLearning, VerifiedPreferenceEvidence } from '../ports/memory-knowledge.interface';
import { createAdaptationGate, type AdaptationGate } from '../../domain/character/adaptation-gate';
import { learnVerifiedCursorPreference } from '../../domain/character/preferences';
import {
  createCharacterSnapshot,
  processStimulusWithAdaptation,
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
  readonly monotonicNow?: () => number;
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
  return Number.isFinite(deltaMs) ? Math.min(60_000, Math.max(0, deltaMs)) : 0;
}

export class CharacterStateService implements ICharacterPreferenceLearning {
  private state: CharacterState;
  private readonly activityEffects = new Set<string>();
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private axesGate: AdaptationGate;
  private preferenceGate: AdaptationGate;
  private readonly observedSources = new Set<string>();

  constructor(options: CharacterStateServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => 0);
    this.axesGate = createAdaptationGate(this.monotonicNow());
    this.preferenceGate = createAdaptationGate(this.monotonicNow());
    this.state =
      options.initialState !== undefined
        ? cloneCharacterState(options.initialState)
        : createDefaultCharacterState(this.now);
  }

  public replaceRestoredState(state: CharacterState): void { this.state = cloneCharacterState(state); this.resetTransientLearning(); }
  public resetToDefaults(): void { this.state = createDefaultCharacterState(this.now); this.resetTransientLearning(); }
  public createDefaults(): CharacterState { return createDefaultCharacterState(this.now); }

  public getState(): CharacterState {
    return cloneCharacterState(this.state);
  }

  public getSnapshot(): CharacterSnapshot {
    return createCharacterSnapshot(this.state);
  }

  public applyStimulus(stimulus: CharacterStimulus): CharacterState {
    const runId = stimulus.metadata?.activityRunId;
    const effect = stimulus.type === 'play' ? 'play' : stimulus.metadata?.activityOutcome === 'explore_completed' ? 'explore' : null;
    if (typeof runId === 'string' && effect) {
      const key = `${runId}:${effect}`;
      if (this.activityEffects.has(key)) return this.getState();
      this.activityEffects.add(key);
      if (this.activityEffects.size > 64) this.activityEffects.delete(this.activityEffects.values().next().value!);
    }
    const result = processStimulusWithAdaptation(this.state, stimulus, this.axesGate, this.monotonicNow());
    this.state = result.state; this.axesGate = result.gate;
    return this.getState();
  }

  public observe(evidence: VerifiedPreferenceEvidence): void {
    if (evidence.key !== 'activity.cursor_game' || (evidence.disposition !== 'like' && evidence.disposition !== 'dislike') || !evidence.sourceMessageId.trim() || evidence.sourceMessageId.length > 128 || this.observedSources.has(evidence.sourceMessageId)) return;
    // Defensive bounded cache; the persisted-turn owner also rejects retired callbacks before this port.
    this.observedSources.add(evidence.sourceMessageId);
    if (this.observedSources.size > 100) this.observedSources.delete(this.observedSources.values().next().value!);
    const learned = learnVerifiedCursorPreference(this.state.preferences, evidence.disposition, this.preferenceGate, this.monotonicNow());
    this.state = { ...this.state, preferences: learned.preferences }; this.preferenceGate = learned.gate;
  }
  private resetTransientLearning(): void {
    this.activityEffects.clear(); this.observedSources.clear();
    this.axesGate = createAdaptationGate(this.monotonicNow()); this.preferenceGate = createAdaptationGate(this.monotonicNow());
  }

  public tickNeeds(deltaMs: number, tone?: SynthesizedEmotionalTone): CharacterState {
    const normalizedDeltaMs = normalizeDeltaMs(deltaMs);
    const metadata: CharacterStimulus['metadata'] = {
      deltaMs: normalizedDeltaMs,
    };

    if (tone !== undefined) {
      metadata.tone = tone;
    } else {
      const synthesized = synthesizeEmotionalTone(this.state);
      metadata.tone = synthesized === 'sleepy' ? 'neutral' : synthesized;
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
