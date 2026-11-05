import { cloneCharacterState, createDefaultCharacterState } from './character-state-factory';
import { createHabitState, interruptHabit, startHabitRun, recordHabitPose, finishHabitRun, habitMultiplier, type HabitState } from '../../domain/character/own-habit';
import { restoreRepairClock, advanceRepairClock, acknowledgeRepairInterruption, canRepair, matchesRepairProof, repairSource, type RepairClock, type RepairEpisode } from '../../domain/character/relationship-repair';
import { applyInteractionProposal, interactionSignature, isNonzeroProposal } from '../../domain/character/interaction-effects';
import type { InteractionAppraisal, PreviousTouchReaction, InteractionReceipt, TouchInteractionReceipt } from '../ports/interaction-appraisal';
import type { ICharacterPreferenceLearning, VerifiedPreferenceEvidence } from '../ports/memory-knowledge.interface';
import { createAdaptationGate, type AdaptationGate } from '../../domain/character/adaptation-gate';
import { learnVerifiedPreference } from '../../domain/character/preferences';
import { appraiseCausalEvent, createCausalAffectState, decayCausalAffect, reappraiseInterruption, relieveCausalInterruption, type CausalEmotion, type CausalObservedEvent } from '../../domain/character/causal-affect';
import type { InterpretationStatus } from '../../domain/character/social-interpretation';
import { createOwnInterestGate, learnOwnGameInterest, reflectOwnGameInterest, OWN_GAME_INTEREST_KEY, type OwnInterestGate, type OwnGameEpisode, type OwnGameReflection } from '../../domain/character/own-game-interest';
import type { CausalSourceReference } from '../../domain/character/types';
import { createActivityExposure, observeActivityExposure, recoverActivityExposure } from '../../domain/character/activity-exposure';
import { causalRelationshipDeltas, shiftRelationshipFacets } from '../../domain/character/relationship-facets';
import {
  createCharacterSnapshot,
  processStimulusWithAdaptation,
  synthesizeEmotionalTone,
} from '../../domain/character';
import type {
  CharacterSnapshot,
  CharacterState,
  CharacterStimulus,
  SynthesizedEmotionalTone,
} from '../../domain/character';

export interface CharacterStateServiceOptions {
  readonly initialState?: CharacterState;
  readonly now?: () => number;
  readonly monotonicNow?: () => number;
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
  private causalAffect = createCausalAffectState();
  private activityExposure = createActivityExposure();
  private ownHabit: HabitState;
  private repairClock: RepairClock;
  private repairProof: RepairEpisode | null = null;
  private pendingRepair: { readonly episode: RepairEpisode; readonly deltas: ReturnType<typeof causalRelationshipDeltas> } | null = null;
  private ownInterestGate: OwnInterestGate;
  private ownInterestProof: readonly CausalSourceReference[] | null = null;

  constructor(options: CharacterStateServiceOptions = {}) {
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.nextAppraisalAt = this.monotonicNow() + 30000;
    this.ownInterestGate = createOwnInterestGate(this.monotonicNow());
    this.axesGate = createAdaptationGate(this.monotonicNow());
    this.preferenceGate = createAdaptationGate(this.monotonicNow());
    this.state =
      options.initialState !== undefined
        ? cloneCharacterState(options.initialState)
        : createDefaultCharacterState(this.now);
    this.ownHabit = createHabitState(this.monotonicNow());
    this.repairClock = restoreRepairClock(this.state.relationshipRepair, this.now(), this.monotonicNow());
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

  public observeCausalEpisode(episode: CausalObservedEvent, atMs: number, repairEpisode?: RepairEpisode): boolean {
    const previousSequence = this.causalAffect.highWaterSequence;
    const exposure = recoverActivityExposure(this.activityExposure, atMs);
    this.causalAffect = appraiseCausalEvent(this.causalAffect, episode, atMs, exposure.habituation);
    if (this.causalAffect.highWaterSequence <= previousSequence) return false;
    this.activityExposure = observeActivityExposure(exposure, episode, atMs);
    const deltas = causalRelationshipDeltas(episode, this.causalAffect.interruptionTimes.length >= 2);
    if (!deltas || atMs < this.nextAppraisalAt) return false;
    this.nextAppraisalAt = atMs + 30000;
    this.repairClock = advanceRepairClock(this.repairClock, this.now(), atMs);
    if (repairEpisode && !this.pendingRepair && canRepair(this.state.relationshipRepair, this.repairClock, this.repairProof,
      repairEpisode, this.state.relationship.resentment, this.now(), atMs)) {
      this.pendingRepair = { episode: repairEpisode, deltas }; return true;
    }
    this.state = { ...this.state, relationship: shiftRelationshipFacets(this.state.relationship, deltas) };
    return false;
  }
  public restoreRelationshipRepair(savedWall = this.now()): void {
    this.pendingRepair = null; this.repairProof = null;
    this.repairClock = restoreRepairClock(this.state.relationshipRepair, this.now(), this.monotonicNow(), savedWall);
  }
  public invalidateRelationshipRepair(): void { this.finishRelationshipRepair(); this.repairProof = null; }
  public setRelationshipRepairProof(episode: RepairEpisode): void {
    if (matchesRepairProof(this.state.relationshipRepair, episode)) this.repairProof = episode;
  }
  public acknowledgeRelationshipInterruption(episode: RepairEpisode, atMs: number): void {
    this.invalidateRelationshipRepair();
    const next = acknowledgeRepairInterruption(this.state.relationshipRepair, episode, atMs, this.now(), this.monotonicNow());
    this.state = { ...this.state, relationshipRepair: next.checkpoint }; this.repairClock = next.clock;
    this.setRelationshipRepairProof(episode);
  }
  public finishRelationshipRepair(acknowledged?: RepairEpisode): void {
    const pending = this.pendingRepair; this.pendingRepair = null;
    if (!pending?.deltas) return;
    const mono = this.monotonicNow(), wall = this.now();
    this.repairClock = advanceRepairClock(this.repairClock, wall, mono);
    const paid = acknowledged && JSON.stringify(acknowledged) === JSON.stringify(pending.episode)
      && canRepair(this.state.relationshipRepair, this.repairClock, this.repairProof, pending.episode,
        this.state.relationship.resentment, wall, mono);
    const deltas = { ...pending.deltas, ...(paid ? { trust: (pending.deltas.trust ?? 0) + 1, resentment: -1 } : {}) };
    this.state = { ...this.state, relationship: shiftRelationshipFacets(this.state.relationship, deltas),
      ...(paid ? { relationshipRepair: { ...this.state.relationshipRepair, lastRepairAt: new Date(wall).toISOString(),
        lastRepairSource: repairSource(pending.episode) } } : {}) };
    if (paid) this.repairClock = { ...this.repairClock, repairReady: mono + 300000 };
  }
  public interruptOwnHabit(): void { this.ownHabit = interruptHabit(this.ownHabit); }
  public invalidateOwnHabit(): void { this.ownHabit = { ...this.ownHabit, cue: null, active: null }; }
  public ownHabitStarted(appRunId: string, runId: string, activityId: string, sequence: number, atMs: number): void {
    this.ownHabit = startHabitRun(this.ownHabit, appRunId, runId, activityId, sequence, atMs);
  }
  public ownHabitPose(runId: string, pose: string): void { this.ownHabit = recordHabitPose(this.ownHabit, runId, pose); }
  public ownHabitFinished(appRunId: string, runId: string, completed: boolean, atMs: number): void {
    const learned = finishHabitRun(this.state.ownHabitMemory, this.ownHabit, appRunId, runId, completed, atMs, new Date(this.now()).toISOString());
    this.ownHabit = learned.state; this.state = { ...this.state, ownHabitMemory: learned.memory };
  }
  public getOwnHabitMultiplier(atMs = this.monotonicNow()): number { return habitMultiplier(this.state.ownHabitMemory, this.ownHabit, atMs); }
  public getCausalEmotion(): CausalEmotion | null {
    return this.causalAffect.emotion ? { ...this.causalAffect.emotion } : null;
  }
  public getCausalAffectGeneration(): number { return this.interactionGeneration; }
  public reappraiseInterruption(causeSequence: number, status: InterpretationStatus, atMs: number, generation = this.interactionGeneration): void {
    if (generation !== this.interactionGeneration) return;
    this.causalAffect = reappraiseInterruption(this.causalAffect, causeSequence, status, atMs);
  }
  public relieveCausalInterruption(causeSequence: number, atMs: number, generation: number): void {
    if (generation !== this.interactionGeneration) return;
    this.causalAffect = relieveCausalInterruption(this.causalAffect, causeSequence, atMs);
  }
  public observeCommittedOwnGame(episode: OwnGameEpisode, atMs: number): boolean {
    const learned = learnOwnGameInterest(this.state.preferences[OWN_GAME_INTEREST_KEY], this.state.ownGameInterestSources, this.ownInterestGate, episode, atMs);
    this.ownInterestGate = learned.gate;
    if (!learned.accepted) return false;
    this.state = { ...this.state, preferences: { ...this.state.preferences, [OWN_GAME_INTEREST_KEY]: learned.track }, ownGameInterestSources: learned.sources };
    this.invalidateOwnGameInterestProof(); return true;
  }
  public invalidateOwnGameInterestProof(): void { this.ownInterestProof = null; }
  public setOwnGameInterestProof(sources: readonly CausalSourceReference[]): void {
    const valid = this.state.ownGameInterestSources.filter(ref => sources.some(source => source.appRunId === ref.appRunId && source.sequence === ref.sequence && source.revision === ref.revision));
    this.state = { ...this.state, ownGameInterestSources: valid.map(ref => ({ ...ref })) };
    this.ownInterestProof = valid;
  }
  public getOwnGameInterest(): OwnGameReflection {
    return reflectOwnGameInterest(this.state.preferences[OWN_GAME_INTEREST_KEY], this.ownInterestProof ?? []);
  }
  public getCursorGameSatiation(): number { return this.activityExposure.satiation; }
  public beginTouch(sequence: number, causalBound = false): TouchInteractionReceipt {
    const before = this.getSnapshot();
    return { ...this.beginInteraction(sequence, 'user_click'),
      ...(causalBound ? { effectPolicy: 'suppressed' as const } : {}),
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
    this.ownHabit = createHabitState(this.monotonicNow());
    this.restoreRelationshipRepair();
    this.causalAffect = createCausalAffectState();
    this.activityExposure = createActivityExposure();
    this.ownInterestGate = createOwnInterestGate(this.monotonicNow()); this.ownInterestProof = null;
    this.interactionGeneration++; this.baseSequence = 0; this.appraisalSequence = 0; this.nextBaseAt = this.monotonicNow(); this.nextAppraisalAt = this.monotonicNow() + 30000;
    this.activityEffects.clear(); this.observedSources.clear();
    this.axesGate = createAdaptationGate(this.monotonicNow()); this.preferenceGate = createAdaptationGate(this.monotonicNow());
  }

  public tickNeeds(deltaMs: number, tone?: SynthesizedEmotionalTone): CharacterState {
    this.causalAffect = decayCausalAffect(this.causalAffect, this.monotonicNow());
    this.activityExposure = recoverActivityExposure(this.activityExposure, this.monotonicNow());
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
