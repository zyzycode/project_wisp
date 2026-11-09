import type { RoutineEvidencePage, RoutineEvidenceQuery, RoutineWindowStart } from '../../application/ports/world-context.interface';
import * as v from './validation';
import { routineIdentity, zone } from './routine-validation';
export function routineWindow(value: unknown): RoutineWindowStart {
  if (value !== 0 && value !== 6 && value !== 12 && value !== 18) throw new v.MemoryDataError('invalid_data');
  return value;
}
export function routineQuery(value: unknown): RoutineEvidenceQuery {
  const p = v.record(value, ['datasetEpoch','cohortId','beforeLocalDate','windowStartHour','zoneId','offsetMinutes','nowUtcMs','expiresAtUtcMs']);
  const date = v.text(p.beforeLocalDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new v.MemoryDataError('invalid_data');
  const nowUtcMs = v.finite(p.nowUtcMs,0,8_639_999_000_000_000), expiresAtUtcMs = v.finite(p.expiresAtUtcMs,nowUtcMs,nowUtcMs + 200);
  return { ...routineIdentity({ datasetEpoch:p.datasetEpoch, cohortId:p.cohortId }), beforeLocalDate:date,
    windowStartHour:routineWindow(p.windowStartHour), zoneId:zone(p.zoneId), offsetMinutes:v.integer(p.offsetMinutes,-840,840), nowUtcMs, expiresAtUtcMs };
}
export function routineSuppression(value: unknown): { window: RoutineWindowStart; suppressed: boolean } {
  const p = v.record(value,['window','suppressed']);
  if (typeof p.suppressed !== 'boolean') throw new v.MemoryDataError('invalid_data');
  return { window:routineWindow(p.window), suppressed:p.suppressed };
}
export function routineEvidence(value: unknown): RoutineEvidencePage {
  const p = v.record(value,['counts','suppressed']);
  if (typeof p.suppressed !== 'boolean') throw new v.MemoryDataError('invalid_data');
  if (p.counts === null) return { counts:null, suppressed:p.suppressed };
  const c = v.record(p.counts,['windowStartHour','eligibleDays','positiveDays','recentPositiveDays','observedThroughDate','qualifies']);
  const eligibleDays = v.integer(c.eligibleDays,0,28), positiveDays = v.integer(c.positiveDays,0,eligibleDays), recentPositiveDays = v.integer(c.recentPositiveDays,0,Math.min(7,positiveDays));
  const observedThroughDate = c.observedThroughDate === null ? null : v.text(c.observedThroughDate,10);
  if (typeof c.qualifies !== 'boolean' || (observedThroughDate !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(observedThroughDate) || new Date(observedThroughDate).toISOString().slice(0,10) !== observedThroughDate))
    || (eligibleDays === 0) !== (observedThroughDate === null)
    || (c.qualifies && (eligibleDays < 14 || positiveDays * 10 < eligibleDays * 7 || recentPositiveDays < 5))) throw new v.MemoryDataError('invalid_data');
  return { counts:{ windowStartHour:routineWindow(c.windowStartHour), eligibleDays,positiveDays,recentPositiveDays,observedThroughDate,qualifies:c.qualifies }, suppressed:p.suppressed };
}
