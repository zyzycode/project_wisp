import { applyInteractionProposal, interactionSignature, isNonzeroProposal } from '../../domain/character/interaction-effects';
import type { InteractionAppraisal, PreviousTouchReaction, InteractionReceipt, TouchInteractionReceipt } from '../ports/interaction-appraisal';
import type { ICharacterPreferenceLearning, VerifiedPreferenceEvidence } from '../ports/memory-knowledge.interface';
import { createAdaptationGate, type AdaptationGate } from '../../domain/character/adaptation-gate';
import { learnVerifiedPreference } from '../../domain/character/preferences';
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
  private interactionGeneration = 0;
  private baseSequence = 0;
  private appraisalSequence = 0;
  private nextBaseAt = 0;
  private nextAppraisalAt = 0;
  private readonly activityEffects = new Set<string>();
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private axesGate: AdaptationGate;
  private preferenceGate: AdaptationGate;
  private readonly observedSources = new Set<string>();

  constructor(options: CharacterStateServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.nextAppraisalAt = this.monotonicNow() + 30000;
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

  public beginTouch(sequence: number): TouchInteractionReceipt {
    const before = this.getSnapshot();
    return { ...this.beginInteraction(sequence, 'user_click'),
      energyBand: before.needs.energy <= 30 ? 'tired' : 'rested', comfortBand: before.needs.comfort >= 80 ? 'overloaded' : 'calm' };
  }
  public beginChat(sequence: number): InteractionReceipt { return this.beginInteraction(sequence, 'user_message'); }
  private beginInteraction(sequence: number, type: 'user_click' | 'user_message'): InteractionReceipt {
    if (sequence > this.baseSequence) {
      this.baseSequence = sequence;
      if (this.monotonicNow() >= this.nextBaseAt) {
        this.nextBaseAt = this.monotonicNow() + 10000;
        const result = processStimulusWithAdaptation(this.state, { type, source: 'user' }, this.axesGate, this.monotonicNow());
        this.state = result.state; this.axesGate = result.gate;
      }
    }
    return { sequence, generation: this.interactionGeneration, signature: interactionSignature(this.getSnapshot()),
      effectPolicy: this.monotonicNow() >= this.nextAppraisalAt ? 'eligible' : 'suppressed' };
  }
  public commitTouch(receipt: TouchInteractionReceipt, proposal?: InteractionAppraisal): Pick<PreviousTouchReaction, 'effect' | 'reason'> {
    return this.commitInteraction(receipt, proposal, true);
  }
  public commitChat(receipt: InteractionReceipt, proposal?: InteractionAppraisal): Pick<PreviousTouchReaction, 'effect' | 'reason'> {
    return this.commitInteraction(receipt, proposal, false);
  }
  private commitInteraction(receipt: InteractionReceipt, proposal: InteractionAppraisal | undefined, touch: boolean): Pick<PreviousTouchReaction, 'effect' | 'reason'> {
    if (receipt.generation !== this.interactionGeneration || receipt.sequence <= this.appraisalSequence) return { effect: 'rejected', reason: 'state_changed' };
    this.appraisalSequence = receipt.sequence;
    if (receipt.signature !== interactionSignature(this.getSnapshot())) return { effect: 'rejected', reason: 'state_changed' };
    if (!proposal || (touch && (proposal.intensity !== 'low' || proposal.category === 'hostile'))) return { effect: 'rejected', reason: 'unavailable' };
    if (!isNonzeroProposal(proposal)) return { effect: 'neutral', reason: proposal.confidence === 'uncertain' ? 'uncertain' : 'neutral' };
    if (receipt.effectPolicy === 'suppressed' || this.monotonicNow() < this.nextAppraisalAt) return { effect: 'suppressed', reason: 'cooldown' };
    this.state = applyInteractionProposal(this.state, proposal);
    this.nextAppraisalAt = this.monotonicNow() + 30000;
    return { effect: 'accepted', reason: 'applied' };
  }
  public applyStimulus(stimulus: CharacterStimulus): CharacterState {
    if (stimulus.type === 'user_message' || stimulus.type === 'chat_message') { this.beginChat(this.baseSequence + 1); return this.getState(); }
    if (['click', 'user_click', 'user_double_click', 'user_right_click'].includes(stimulus.type)) { this.beginTouch(this.baseSequence + 1); return this.getState(); }
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
    if (!['activity.cursor_game', 'activity.explore', 'activity.social_bid'].includes(evidence.key)
        || (evidence.disposition !== 'like' && evidence.disposition !== 'dislike') || !evidence.sourceMessageId.trim()
        || evidence.sourceMessageId.length > 128 || this.observedSources.has(evidence.sourceMessageId)) return;
    // Defensive bounded cache; the persisted-turn owner also rejects retired callbacks before this port.
    this.observedSources.add(evidence.sourceMessageId);
    if (this.observedSources.size > 100) this.observedSources.delete(this.observedSources.values().next().value!);
    const learned = learnVerifiedPreference(this.state.preferences, evidence.key, evidence.disposition, this.preferenceGate, this.monotonicNow());
    this.state = { ...this.state, preferences: learned.preferences }; this.preferenceGate = learned.gate;
  }
  private resetTransientLearning(): void {
    this.interactionGeneration++; this.baseSequence = 0; this.appraisalSequence = 0; this.nextBaseAt = this.monotonicNow(); this.nextAppraisalAt = this.monotonicNow() + 30000;
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
