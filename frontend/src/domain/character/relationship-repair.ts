import type { CausalObservedEvent } from './causal-affect';
import type { CausalSourceReference } from './types';
export interface RepairCheckpoint {
  readonly lastInterruptionAt: string | null;
  readonly lastInterruptionSource: CausalSourceReference | null;
  readonly lastRepairAt: string | null;
  readonly lastRepairSource: CausalSourceReference | null;
}
export interface RepairEpisode extends CausalObservedEvent, CausalSourceReference { readonly occurredAt: string; }
export interface RepairClock {
  readonly wall: number; readonly mono: number; readonly quarantined: boolean;
  readonly interruptionReady: number; readonly repairReady: number; readonly expires: number;
}
export const REPAIR_INTERVAL_MS = 300000;
const TTL = 86400000;
export function emptyRepairCheckpoint(): RepairCheckpoint {
  return { lastInterruptionAt: null, lastInterruptionSource: null, lastRepairAt: null, lastRepairSource: null };
}
export function sameRepairSource(a: CausalSourceReference | null, b: CausalSourceReference | null): boolean {
  return a !== null && b !== null && a.appRunId === b.appRunId && a.sequence === b.sequence && a.revision === b.revision;
}
export function repairSource(episode: RepairEpisode): CausalSourceReference {
  return { appRunId: episode.appRunId, sequence: episode.sequence, revision: episode.revision };
}
export function isRepairInterruption(e: RepairEpisode): boolean {
  return e.activity === 'cursor_game' && !!e.activityRunId && e.source === 'user' && e.cause === 'user_interrupted'
    && e.outcome === 'cancelled' && e.triggerSequence !== null && e.triggerSequence > 0 && e.executedMs >= 1000;
}
export function isRepairCompletion(e: RepairEpisode): boolean {
  return e.activity === 'cursor_game' && !!e.activityRunId && e.cause === 'completed' && e.outcome === 'completed'
    && e.participation === 'user_engaged' && e.executedMs >= 1000;
}
export function restoreRepairClock(c: RepairCheckpoint, wall: number, mono: number, savedWall = wall): RepairClock {
  const interruption = c.lastInterruptionAt === null ? NaN : Date.parse(c.lastInterruptionAt);
  const repair = c.lastRepairAt === null ? null : Date.parse(c.lastRepairAt);
  const valid = Number.isFinite(wall) && Number.isFinite(mono) && mono >= 0 && Number.isFinite(savedWall) && wall >= savedWall
    && Number.isFinite(interruption) && interruption <= wall && (repair === null || (Number.isFinite(repair) && repair <= wall));
  return { wall, mono, quarantined: !valid,
    interruptionReady: mono + Math.max(0, interruption + REPAIR_INTERVAL_MS - wall),
    repairReady: repair === null ? mono : mono + Math.max(0, repair + REPAIR_INTERVAL_MS - wall), expires: mono + interruption + TTL - wall };
}
export function advanceRepairClock(c: RepairClock, wall: number, mono: number): RepairClock {
  return { ...c, wall, mono, quarantined: c.quarantined || !Number.isFinite(wall) || !Number.isFinite(mono)
    || mono < 0 || wall < c.wall || mono < c.mono };
}
export function acknowledgeRepairInterruption(checkpoint: RepairCheckpoint, episode: RepairEpisode, observedAt: number, wall: number, mono: number): {
  readonly checkpoint: RepairCheckpoint; readonly clock: RepairClock;
} {
  const futureRepair = checkpoint.lastRepairAt !== null && Date.parse(checkpoint.lastRepairAt) > wall;
  const next = { ...checkpoint, lastInterruptionAt: episode.occurredAt, lastInterruptionSource: repairSource(episode),
    ...(futureRepair ? { lastRepairAt: null, lastRepairSource: null } : {}) };
  const clock = restoreRepairClock(next, wall, mono);
  return { checkpoint: next, clock: { ...clock, interruptionReady: observedAt + REPAIR_INTERVAL_MS, expires: observedAt + TTL,
    quarantined: clock.quarantined || !Number.isFinite(observedAt) || observedAt < 0 || observedAt > mono } };
}
/** A source read validates a marker; it never creates experience or changes a facet. */
export function matchesRepairProof(checkpoint: RepairCheckpoint, episode: RepairEpisode): boolean {
  return isRepairInterruption(episode) && sameRepairSource(checkpoint.lastInterruptionSource, episode)
    && checkpoint.lastInterruptionAt === episode.occurredAt;
}
export function canRepair(checkpoint: RepairCheckpoint, clock: RepairClock, proof: RepairEpisode | null, completed: RepairEpisode,
  resentment: number, wall: number, mono: number): boolean {
  const current = advanceRepairClock(clock, wall, mono);
  return !current.quarantined && resentment > 0 && proof !== null && matchesRepairProof(checkpoint, proof)
    && isRepairCompletion(completed) && !sameRepairSource(checkpoint.lastRepairSource, completed)
    && Date.parse(completed.occurredAt) <= wall && Date.parse(completed.occurredAt) >= Date.parse(proof.occurredAt) + REPAIR_INTERVAL_MS
    && mono >= current.interruptionReady && mono >= current.repairReady && mono < current.expires;
}
