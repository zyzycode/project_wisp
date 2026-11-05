import { takeAdaptationOpportunity } from './adaptation-gate';
import type { OwnInterestGate } from './own-game-interest';
import type { CausalSourceReference, PreferenceTrack } from './types';

export const OWN_BOOK_INTEREST_KEY = 'own.activity.book';
export interface OwnBookEpisode extends CausalSourceReference {
  readonly source: string;
  readonly terminalReason: string | null;
  readonly triggerSequence: number | null;
  readonly activity: string | null;
  readonly activityRunId: string | null;
  readonly cause: string;
  readonly outcome: string | null;
  readonly participation: string;
  readonly executedMs: number;
}
export interface OwnBookReflection {
  readonly band: 'none' | 'emerging' | 'established';
  readonly multiplier: number;
  readonly sources: readonly CausalSourceReference[];
}
function validReference(ref: CausalSourceReference): boolean {
  return ref.revision === 1 && !!ref.appRunId.trim() && ref.appRunId.length <= 128
    && Number.isSafeInteger(ref.sequence) && ref.sequence > 0;
}
export function isOwnBookSource(episode: OwnBookEpisode): boolean {
  return validReference(episode) && !!episode.activityRunId?.trim() && episode.activityRunId.length <= 128
    && episode.source === 'autonomy' && episode.terminalReason === null && episode.triggerSequence === null
    && episode.activity === 'book' && episode.cause === 'completed' && episode.outcome === 'completed'
    && episode.participation === 'solitary' && Number.isFinite(episode.executedMs)
    && episode.executedMs >= 14_000 && episode.executedMs <= 600_000;
}
function validTrack(track: PreferenceTrack | undefined): PreferenceTrack {
  return track && Number.isFinite(track.value) && track.value >= 0 && track.value <= 100
    && Number.isInteger(track.samples) && track.samples >= 0 && track.samples <= 1000
    ? { ...track, confidence: track.samples / (track.samples + 6) } : { value: 0, samples: 0, confidence: 0 };
}
/** Caller supplies the same gate used by cursor learning, after durable acknowledgement. */
export function learnOwnBookInterest(track: PreferenceTrack | undefined, sources: readonly CausalSourceReference[],
  gate: OwnInterestGate, episode: OwnBookEpisode, nowMs: number, currentAppRunId: string): {
    readonly track: PreferenceTrack; readonly sources: readonly CausalSourceReference[];
    readonly gate: OwnInterestGate; readonly accepted: boolean;
  } {
  const previous = validTrack(track);
  if (!isOwnBookSource(episode) || episode.appRunId !== currentAppRunId
    || (gate.appRunId !== null && gate.appRunId !== episode.appRunId) || episode.sequence <= gate.highWater) {
    return { track: previous, sources, gate, accepted: false };
  }
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
/** Sources must already have been resolved as exact eligible book episodes, never numeric taste alone. */
export function reflectOwnBookInterest(track: PreferenceTrack | undefined, provenSources: readonly CausalSourceReference[]): OwnBookReflection {
  const valid = validTrack(track);
  const sources = provenSources.filter((ref, i, all) => validReference(ref)
    && all.findIndex(other => other.appRunId === ref.appRunId && other.sequence === ref.sequence) === i).slice(-20);
  if (sources.length < 6 || valid.confidence < .5) return { band: 'none', multiplier: 1, sources: [] };
  return { band: sources.length < 20 ? 'emerging' : 'established', multiplier: 1 + .2 * valid.value / 100,
    sources: sources.map(ref => ({ ...ref })) };
}
