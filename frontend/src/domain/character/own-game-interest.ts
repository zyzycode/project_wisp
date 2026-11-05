import { createAdaptationGate, takeAdaptationOpportunity, type AdaptationGate } from './adaptation-gate';
import type { CausalSourceReference, PreferenceTrack } from './types';
import { localPreferenceMultiplier, type LearnedPreference } from './preferences';

export const OWN_GAME_INTEREST_KEY = 'own.activity.cursor_game';
export interface OwnGameEpisode extends CausalSourceReference {
  readonly source: string;
  readonly terminalReason: string | null;
  readonly triggerSequence: number | null;
  readonly activity: 'cursor_game' | null;
  readonly activityRunId: string | null;
  readonly cause: string;
  readonly outcome: string | null;
  readonly participation: string;
  readonly executedMs: number;
}
export interface OwnInterestGate {
  readonly learning: AdaptationGate;
  readonly appRunId: string | null;
  readonly highWater: number;
}
export interface OwnGameReflection {
  readonly band: 'none' | 'emerging' | 'established';
  readonly multiplier: number;
  readonly sources: readonly CausalSourceReference[];
}
export function createOwnInterestGate(nowMs: number): OwnInterestGate {
  return { learning: createAdaptationGate(nowMs), appRunId: null, highWater: 0 };
}
export function isOwnGameSource(episode: OwnGameEpisode): boolean {
  return episode.revision === 1 && !!episode.appRunId.trim() && episode.appRunId.length <= 128
    && Number.isSafeInteger(episode.sequence) && episode.sequence > 0 && !!episode.activityRunId
    && episode.source === 'autonomy' && episode.terminalReason === null && episode.triggerSequence === null
    && episode.activity === 'cursor_game' && episode.cause === 'completed' && episode.outcome === 'completed'
    && episode.participation === 'user_engaged' && Number.isFinite(episode.executedMs)
    && episode.executedMs >= 1000 && episode.executedMs <= 600000;
}
function validTrack(track: PreferenceTrack | undefined): PreferenceTrack {
  return track && Number.isFinite(track.value) && track.value >= 0 && track.value <= 100
    && Number.isInteger(track.samples) && track.samples >= 0 && track.samples <= 1000
    ? { ...track, confidence: track.samples / (track.samples + 6) } : { value: 0, samples: 0, confidence: 0 };
}
export function learnOwnGameInterest(track: PreferenceTrack | undefined, sources: readonly CausalSourceReference[],
  gate: OwnInterestGate, episode: OwnGameEpisode, nowMs: number): {
    readonly track: PreferenceTrack; readonly sources: readonly CausalSourceReference[];
    readonly gate: OwnInterestGate; readonly accepted: boolean;
  } {
  const previous = validTrack(track);
  if (!isOwnGameSource(episode) || (gate.appRunId !== null && gate.appRunId !== episode.appRunId)
    || episode.sequence <= gate.highWater) return { track: previous, sources, gate, accepted: false };
  const once = { ...gate, appRunId: episode.appRunId, highWater: episode.sequence };
  const duplicate = sources.some(ref => ref.appRunId === episode.appRunId && ref.sequence === episode.sequence);
  const opportunity = takeAdaptationOpportunity(gate.learning, nowMs, !duplicate);
  const nextGate = { ...once, learning: opportunity.gate };
  if (!opportunity.accepted) return { track: previous, sources, gate: nextGate, accepted: false };
  const samples = Math.min(1000, previous.samples + 1);
  return { accepted: true, gate: nextGate,
    track: { value: Math.min(100, previous.value + 1), samples, confidence: samples / (samples + 6) },
    sources: [...sources, { appRunId: episode.appRunId, sequence: episode.sequence, revision: 1 as const }].slice(-20) };
}
export function reflectOwnGameInterest(track: PreferenceTrack | undefined, provenSources: readonly CausalSourceReference[]): OwnGameReflection {
  const valid = validTrack(track);
  if (provenSources.length < 6 || valid.confidence < .5) return { band: 'none', multiplier: 1, sources: [] };
  return { band: provenSources.length < 20 ? 'emerging' : 'established', multiplier: 1 + .2 * valid.value / 100,
    sources: provenSources.map(ref => ({ ...ref })) };
}

/** Preserve the existing additive user-preference mapping while capping the combined coefficient. */
export function effectiveOwnGameMultiplier(user: LearnedPreference | undefined, own: number | undefined): number {
  if (own === undefined || !Number.isFinite(own) || own < 1 || own > 1.2) return 1;
  const userMultiplier = localPreferenceMultiplier(user);
  return Math.min(1.2, Math.max(.8, userMultiplier * own)) / userMultiplier;
}
