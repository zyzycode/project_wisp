import type { BackendRoutineHypothesis } from '../../application/ports/backend-routine-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';
/** Exact bounded optional projection; raw diary and local identity never cross this boundary. */
export function parseRoutineHypothesis(value: unknown): BackendRoutineHypothesis {
  const p = exactRecord(value, ['scope','validity','windowStartHour','eligibleDays','positiveDays','recentPositiveDays','observedThroughDate']);
  const count = (v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new TypeError('Invalid routine count');
    return v;
  };
  if (p.windowStartHour !== 0 && p.windowStartHour !== 6 && p.windowStartHour !== 12 && p.windowStartHour !== 18) throw new TypeError('Invalid routine window');
  if (typeof p.observedThroughDate !== 'string' || !/^\d{4}-\d\d-\d\d$/u.test(p.observedThroughDate) || !Number.isFinite(Date.parse(p.observedThroughDate))
    || new Date(p.observedThroughDate).toISOString().slice(0,10) !== p.observedThroughDate) throw new TypeError('Invalid routine date');
  const eligibleDays = count(p.eligibleDays,14,28), positiveDays = count(p.positiveDays,0,eligibleDays), recentPositiveDays = count(p.recentPositiveDays,5,Math.min(7,positiveDays));
  const result: BackendRoutineHypothesis = { scope:enumValue(p.scope,['while_wisp_running']), validity:enumValue(p.validity,['tentative']),
    windowStartHour:p.windowStartHour, eligibleDays,positiveDays,recentPositiveDays,observedThroughDate:p.observedThroughDate };
  if (positiveDays * 10 < eligibleDays * 7 || new TextEncoder().encode(JSON.stringify(result)).byteLength > 512
    || Object.values(result).filter(v => typeof v === 'string').join('').length > 128) throw new TypeError('Incoherent routine projection');
  return result;
}
