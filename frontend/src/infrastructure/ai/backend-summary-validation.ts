import { summaryPlainText } from '../../shared/summary-text-validation';
import type { AIProviderRequest } from '../../application/ports/ai-provider.interface';
import type { BackendSummaryRequest, BackendSummaryChatRequest } from '../../application/ports/backend-summary-contract';
import { backendRequestId } from './backend-request-projection';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';
import { projectEventAwareChat } from './backend-events-validation';
export function parseSummaryRequest(value: unknown): BackendSummaryRequest {
  const r = exactRecord(value, ['version', 'requestId', 'locale', 'stream', 'pairs']);
  if (r.version !== 1 || r.stream !== false || !Array.isArray(r.pairs) || r.pairs.length < 4 || r.pairs.length > 8) throw new TypeError('Invalid summary request');
  const requestId = backendRequestId(r.requestId);
  const pairs = r.pairs.map((value: unknown) => { const pair = exactRecord(value, ['userText', 'assistantText']); return { userText: summaryPlainText(pair.userText, 240), assistantText: summaryPlainText(pair.assistantText, 2000) }; });
  if (pairs.reduce((sum, p) => sum + p.userText.length + p.assistantText.length, 0) > 8000 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 32768) throw new TypeError('Summary budget');
  return { version: 1, requestId, locale: enumValue(r.locale, ['ru', 'en']), stream: false, pairs };
}
export function parseSummaryResponse(value: unknown, requestId: string) {
  const r = exactRecord(value, ['version', 'requestId', 'text']);
  if (r.version !== 1 || r.requestId !== requestId) throw new TypeError('Invalid summary response');
  return { version: 1 as const, requestId, text: summaryPlainText(r.text, 1200) };
}
export function projectSummaryChat(request: AIProviderRequest): BackendSummaryChatRequest {
  const base = projectEventAwareChat(request);
  const summary = request.summary === undefined ? undefined : { text: summaryPlainText(exactRecord(request.summary, ['text']).text, 1200) };
  const result: BackendSummaryChatRequest = { ...base, ...(summary ? { summary } : {}) };
  // Summary drops atomically before any further optional episode trimming.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768) return base;
  return result;
}
export { parseBackendMemorySuccess as parseSummaryChatResponse } from './backend-memory-validation';
export { parseBackendError as parseSummaryError } from './backend-response-validation';
