import type { BackendLifeReflection } from '../../application/ports/backend-life-history-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';

export function parseLifeReflection(value: unknown): BackendLifeReflection {
  const p = exactRecord(value, ['scope', 'validity', 'kind', 'fromDate', 'throughDate', 'completedCount', 'interruptedCount', 'completedDays']);
  const date = (v: unknown): string => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/u.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new TypeError('Invalid reflection date');
    return v;
  };
  const count = (v: unknown, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new TypeError('Invalid reflection count');
    return v;
  };
  const result: BackendLifeReflection = { scope: enumValue(p.scope, ['observed_utc_window']), validity: enumValue(p.validity, ['tentative']), kind: enumValue(p.kind, ['shared_game_completions']),
    fromDate: date(p.fromDate), throughDate: date(p.throughDate), completedCount: count(p.completedCount, 6, 1000), interruptedCount: count(p.interruptedCount, 0, 1000), completedDays: count(p.completedDays, 3, 14) };
  const span = (Date.parse(result.throughDate) - Date.parse(result.fromDate)) / 86400000 + 1;
  const total = result.completedCount + result.interruptedCount;
  if (span < 1 || span > 14 || result.completedDays > span || result.completedDays > result.completedCount || total > 1000 || result.completedCount * 10 < total * 7
    || new TextEncoder().encode(JSON.stringify(result)).byteLength > 512 || Object.values(result).filter(v => typeof v === 'string').join('').length > 128) throw new TypeError('Incoherent life reflection');
  return result;
}
