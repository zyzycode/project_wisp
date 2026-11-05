import type { LifeSummaryPreviewDTO } from './ipc-contracts';
import { exactRecord, enumValue } from './dialogue-ipc-validation';
export function lifeSummaryDates(first: unknown, last: unknown): { fromDate: string; throughDate: string } {
  const date = (v: unknown) => { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/u.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new TypeError('Invalid life summary date'); return v; };
  const fromDate = date(first), throughDate = date(last), span = (Date.parse(throughDate) - Date.parse(fromDate)) / 86400000;
  if (span < 0 || span > 13) throw new TypeError('Invalid life summary range');
  return { fromDate, throughDate };
}
export function parseLifeSummaryEvents(value: unknown, fromDate: string, throughDate: string): readonly LifeSummaryPreviewDTO['events'][number][] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 8) throw new TypeError('Invalid life summary sources');
  const events = value.map((value: unknown): LifeSummaryPreviewDTO['events'][number] => {
    const e = exactRecord(value, ['activity','outcome','cause','actor','participation','executedMs','occurredAt']);
    if (typeof e.executedMs !== 'number' || !Number.isFinite(e.executedMs) || e.executedMs < 0 || e.executedMs > 600000) throw new TypeError('Invalid execution time');
    if (typeof e.occurredAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(e.occurredAt) || !Number.isFinite(Date.parse(e.occurredAt)) || new Date(e.occurredAt).toISOString() !== e.occurredAt || e.occurredAt.slice(0,10) < fromDate || e.occurredAt.slice(0,10) > throughDate) throw new TypeError('Invalid event date');
    const result = { activity: enumValue(e.activity, ['cursor_game']), outcome: enumValue(e.outcome, ['completed','cancelled','failed']), cause: enumValue(e.cause, ['completed','user_interrupted','environment_lost','timeout']), actor: enumValue(e.actor, ['user','system','autonomy','unknown']), participation: enumValue(e.participation, ['user_engaged','solitary','none']), executedMs: e.executedMs, occurredAt: e.occurredAt };
    if ((result.outcome === 'completed') !== (result.cause === 'completed') || (result.cause === 'user_interrupted' && (result.actor !== 'user' || result.outcome !== 'cancelled')) || ((result.cause === 'environment_lost' || result.cause === 'timeout') && result.actor !== 'system')) throw new TypeError('Incoherent event');
    return result;
  });
  if (events.some((e,i) => i > 0 && e.occurredAt < events[i-1]!.occurredAt)) throw new TypeError('Unordered events');
  return events;
}
