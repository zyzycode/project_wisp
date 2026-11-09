import type { RoutineHypothesisCommandDTO, RoutineHypothesisReadDTO, RoutineHypothesisReadResultDTO, RoutineHypothesisResultDTO, RoutineHypothesisStateDTO, RoutineWindowDTO } from './routine-hypothesis-contracts';
import { exactRecord, plainText, enumValue } from './dialogue-ipc-validation';
const bool = (value: unknown): boolean => { if (typeof value !== 'boolean') throw new TypeError('Invalid routine switch'); return value; };
const integer = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError('Invalid routine count'); return value; };
const window = (value: unknown): RoutineWindowDTO => { if (value !== 0 && value !== 6 && value !== 12 && value !== 18) throw new TypeError('Invalid routine window'); return value; };
export function parseRoutineRead(value: unknown): RoutineHypothesisReadDTO { const p = exactRecord(value,['streamId']); return { streamId:plainText(p.streamId,128) }; }
export function parseRoutineCommand(value: unknown): RoutineHypothesisCommandDTO {
  const raw = exactRecord(value,['streamId','requestId','sequence','kind'],['enabled','windowStartHour','suppressed']);
  const base = { streamId:plainText(raw.streamId,128), requestId:plainText(raw.requestId,128), sequence:integer(raw.sequence,1) };
  if (raw.kind === 'sharing') { exactRecord(raw,['streamId','requestId','sequence','kind','enabled']); return { ...base, kind:'sharing', enabled:bool(raw.enabled) }; }
  exactRecord(raw,['streamId','requestId','sequence','kind','windowStartHour','suppressed']);
  if (raw.kind !== 'suppression') throw new TypeError('Invalid routine command');
  return { ...base, kind:'suppression', windowStartHour:window(raw.windowStartHour), suppressed:bool(raw.suppressed) };
}
export function parseRoutineState(value: unknown): RoutineHypothesisStateDTO {
  const p = exactRecord(value,['sharing','available','backendAvailable','suppressed','windowStartHour','counts']);
  let counts: RoutineHypothesisStateDTO['counts'] = null;
  if (p.counts !== null) {
    const c = exactRecord(p.counts,['eligibleDays','positiveDays','recentPositiveDays','observedThroughDate','qualifies']);
    const eligibleDays = integer(c.eligibleDays,0,28), positiveDays = integer(c.positiveDays,0,eligibleDays), recentPositiveDays = integer(c.recentPositiveDays,0,Math.min(7,positiveDays));
    const observedThroughDate = c.observedThroughDate === null ? null : plainText(c.observedThroughDate,10);
    if (observedThroughDate !== null && (!/^\d{4}-\d{2}-\d{2}$/u.test(observedThroughDate) || !Number.isFinite(Date.parse(observedThroughDate)) || new Date(observedThroughDate).toISOString().slice(0,10) !== observedThroughDate)) throw new TypeError('Invalid routine date');
    if ((eligibleDays === 0) !== (observedThroughDate === null)) throw new TypeError('Invalid routine coverage');
    const qualifies = bool(c.qualifies);
    if (qualifies && (eligibleDays < 14 || positiveDays * 10 < eligibleDays * 7 || recentPositiveDays < 5)) throw new TypeError('Invalid routine threshold');
    counts = { eligibleDays,positiveDays,recentPositiveDays,observedThroughDate,qualifies };
  }
  return { sharing:bool(p.sharing), available:bool(p.available), backendAvailable:bool(p.backendAvailable), suppressed:bool(p.suppressed), windowStartHour:window(p.windowStartHour), counts };
}
export function parseRoutineReadResult(value: unknown): RoutineHypothesisReadResultDTO {
  const p = exactRecord(value,['ok'],['state','code']);
  if (p.ok === true) { exactRecord(p,['ok','state']); return { ok:true, state:parseRoutineState(p.state) }; }
  exactRecord(p,['ok','code']); if (p.ok !== false) throw new TypeError('Invalid routine result');
  return { ok:false, code:enumValue(p.code,['stale','busy','unavailable']) };
}
export function parseRoutineResult(value: unknown): RoutineHypothesisResultDTO {
  const p = exactRecord(value,['requestId','ok'],['code']);
  const requestId = plainText(p.requestId,128);
  if (p.ok === true) { exactRecord(p,['requestId','ok']); return { requestId,ok:true }; }
  exactRecord(p,['requestId','ok','code']); if (p.ok !== false) throw new TypeError('Invalid routine receipt');
  return { requestId,ok:false,code:enumValue(p.code,['stale','busy','unavailable']) };
}
