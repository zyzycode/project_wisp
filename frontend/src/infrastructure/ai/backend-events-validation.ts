import type { AIEventProviderRequest } from '../../application/ports/ai-event-provider.interface';
import type { AIProviderRequest } from '../../application/ports/ai-provider.interface';
import type { BackendEventRequest, BackendEventAwareChatRequest } from '../../application/ports/backend-events-contract';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import { projectBackendMemoryRequest } from './backend-memory-validation';
import { finiteRange } from './backend-request-projection';
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Invalid event time'); return value;
}
function fit<T extends BackendEventRequest | BackendEventAwareChatRequest>(request: T): T {
  let result = request;
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768 && result.memory.episodes.length) result = { ...result, memory: { ...result.memory, episodes: result.memory.episodes.slice(0, -1) } };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32768) throw new TypeError('Request too large'); return result;
}
export function projectEventRequest(request: AIEventProviderRequest): BackendEventRequest {
  const base = projectBackendMemoryRequest({ requestId: request.requestId, userMessage: { id: '', text: 'projection', createdAt: '' }, recentContext: [], characterSnapshot: request.characterSnapshot, memoryContext: request.memoryContext, locale: request.locale });
  const e = exactRecord(request.event, ['type', 'occurredAt'], ['outcome', 'executedMs']);
  const occurredAt = utc(e.occurredAt);
  const event = e.type === 'social_bid_started'
    ? (exactRecord(e, ['type', 'occurredAt']), { type: 'social_bid_started' as const, occurredAt })
    : (exactRecord(e, ['type', 'occurredAt', 'outcome', 'executedMs']), { type: enumValue(e.type, ['cursor_game_completed']), occurredAt, outcome: enumValue(e.outcome, ['caught', 'missed', 'lost_target']), executedMs: finiteRange(e.executedMs, 60000) });
  return fit({ requestId: base.requestId, event, stream: false, locale: base.locale, character: base.character, memory: base.memory });
}
export function projectEventAwareChat(request: AIProviderRequest): BackendEventAwareChatRequest {
  const base = projectBackendMemoryRequest(request);
  if (request.previousInitiative === undefined) return base;
  const p = exactRecord(request.previousInitiative, ['kind', 'text', 'createdAt']);
  return fit({ ...base, previousInitiative: { kind: enumValue(p.kind, ['cursor_game', 'social_bid']), text: plainText(p.text, 240, true), createdAt: utc(p.createdAt) } });
}
export function parseEventResponse(value: unknown, requestId: string) {
  const r = exactRecord(value, ['requestId', 'text']);
  if (r.requestId !== requestId) throw new TypeError('Invalid event envelope');
  return { requestId, replyText: plainText(r.text, 240, true) };
}
export { parseBackendMemorySuccess as parseEventAwareChat } from './backend-memory-validation';
export { parseBackendError as parseEventError } from './backend-response-validation';
