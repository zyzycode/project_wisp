import type { RoutineCaptureIdentity, RoutineCaptureStart, RoutineObservation, RoutineStoredStatus } from '../../application/ports/routine-observation.port';
import * as v from './validation';

const utc = (value: unknown) => v.finite(value, 0, 8_639_999_000_000_000);
export function zone(value: unknown): string {
  const result = v.text(value, 128);
  try { new Intl.DateTimeFormat('en', { timeZone: result }); } catch { throw new v.MemoryDataError('invalid_data'); }
  // Intl also accepts offset identifiers in newer runtimes; these are not IANA zones.
  if (/^[+-]/u.test(result)) throw new v.MemoryDataError('invalid_data');
  return result;
}
export function routineIdentity(value: unknown): RoutineCaptureIdentity {
  const p = v.record(value, ['datasetEpoch', 'cohortId']);
  return { datasetEpoch: v.text(p.datasetEpoch), cohortId: v.text(p.cohortId) };
}
export function routineStart(value: unknown): RoutineCaptureStart {
  const p = v.record(value, ['atUtcMs', 'zoneId', 'offsetMinutes', 'candidateCohortId', 'forceNewCohort']);
  if (typeof p.forceNewCohort !== 'boolean') throw new v.MemoryDataError('invalid_data');
  return { atUtcMs: utc(p.atUtcMs), zoneId: zone(p.zoneId), offsetMinutes: v.integer(p.offsetMinutes, -840, 840), candidateCohortId: v.text(p.candidateCohortId), forceNewCohort: p.forceNewCohort };
}
export function routineObservation(value: unknown): RoutineObservation {
  const p = v.record(value, ['datasetEpoch','cohortId','appRunId','sequence','startUtcMs','endUtcMs','zoneId','offsetMinutes','localDate','tuningId','activeMs','inactiveMs','awayMs','unknownMs']);
  const startUtcMs = utc(p.startUtcMs), endUtcMs = utc(p.endUtcMs);
  const offsetMinutes = v.integer(p.offsetMinutes, -840, 840), localDate = v.text(p.localDate, 10);
  const activeMs = v.finite(p.activeMs, 0, 300000), inactiveMs = v.finite(p.inactiveMs, 0, 300000), awayMs = v.finite(p.awayMs, 0, 300000), unknownMs = v.finite(p.unknownMs, 0, 300000);
  const span = endUtcMs - startUtcMs;
  if (span <= 0 || span > 300000 || Math.floor(startUtcMs / 300000) !== Math.ceil(endUtcMs / 300000) - 1
    || activeMs + inactiveMs + awayMs + unknownMs > span + 1e-6 || p.tuningId !== 'AFK-A01-v1'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(localDate)
    || new Date(startUtcMs + offsetMinutes * 60000).toISOString().slice(0,10) !== localDate
    || new Date(Math.ceil(endUtcMs) - 1 + offsetMinutes * 60000).toISOString().slice(0,10) !== localDate) throw new v.MemoryDataError('invalid_data');
  return { datasetEpoch: v.text(p.datasetEpoch), cohortId: v.text(p.cohortId), appRunId: v.text(p.appRunId), sequence: v.integer(p.sequence, 1), startUtcMs, endUtcMs, zoneId: zone(p.zoneId), offsetMinutes, localDate, tuningId: 'AFK-A01-v1', activeMs, inactiveMs, awayMs, unknownMs };
}
export function routineStatus(value: unknown): RoutineStoredStatus {
  const p = v.record(value, ['datasetEpoch','cohortId','latestEndUtcMs','zoneId','offsetMinutes']);
  return { datasetEpoch: v.text(p.datasetEpoch), cohortId: v.text(p.cohortId), latestEndUtcMs: p.latestEndUtcMs === null ? null : utc(p.latestEndUtcMs), zoneId: p.zoneId === null ? null : zone(p.zoneId), offsetMinutes: p.offsetMinutes === null ? null : v.integer(p.offsetMinutes, -840,840) };
}
