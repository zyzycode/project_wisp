import { lifeSummaryDates, parseLifeSummaryEvents } from '../../shared/life-summary-validation';
import type { BackendLifeSummaryContext, BackendLifeSummaryRequest } from '../../application/ports/backend-life-history-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';
import { summaryPlainText } from '../../shared/summary-text-validation';
import { backendRequestId } from './backend-request-projection';
export function parseLifeSummaryRequest(value: unknown): BackendLifeSummaryRequest {
  const r = exactRecord(value, ['requestId','locale','stream','fromDate','throughDate','events']);
  if (r.stream !== false) throw new TypeError('Invalid summary stream');
  const dates = lifeSummaryDates(r.fromDate, r.throughDate);
  const result = { requestId: backendRequestId(r.requestId), locale: enumValue(r.locale, ['ru','en']), stream: false as const, ...dates, events: parseLifeSummaryEvents(r.events, dates.fromDate, dates.throughDate) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 8192) throw new TypeError('Summary source budget');
  return result;
}
export function parseLifeSummaryContext(value: unknown): BackendLifeSummaryContext {
  const r = exactRecord(value, ['sourceKind','text','fromDate','throughDate','eventCount']);
  if (r.sourceKind !== 'life_events' || typeof r.eventCount !== 'number' || !Number.isSafeInteger(r.eventCount) || r.eventCount < 4 || r.eventCount > 8) throw new TypeError('Invalid summary context');
  return { sourceKind: 'life_events', text: summaryPlainText(r.text, 1200), ...lifeSummaryDates(r.fromDate, r.throughDate), eventCount: r.eventCount };
}
