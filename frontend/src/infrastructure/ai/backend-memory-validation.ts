import type { BackendMemoryCandidate, BackendMemoryContext, BackendMemoryRequest, BackendMemoryResponse, BackendMemoryErrorResponse } from '../../application/ports/backend-memory-contract';
import type { AIProviderRequest } from '../../application/ports/ai-provider.interface';
import { exactRecord, enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import { finiteRange, projectBackendRequest } from './backend-request-projection';
import { parseBackendSuccess, parseBackendError } from './backend-response-validation';

function array(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new TypeError('Invalid memory array'); return value;
}
function fact(value: unknown): BackendMemoryContext['facts'][number] {
  const r = exactRecord(value, ['key', 'value']);
  const key = enumValue(r.key, ['user.display_name', 'user.preferred_address', 'user.favorite_topic', 'user.reply_style', 'user.cursor_game']);
  const text = plainText(r.value, key === 'user.favorite_topic' ? 120 : 80, true);
  if (key === 'user.reply_style') enumValue(text, ['brief', 'detailed']);
  if (key === 'user.cursor_game') enumValue(text, ['like', 'dislike']);
  return { key, value: text };
}
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Invalid memory timestamp');
  return value;
}
function stringSize(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item: unknown) => sum + stringSize(item), 0);
  if (value && typeof value === 'object') return Object.values(value).reduce<number>((sum, item: unknown) => sum + stringSize(item), 0);
  return 0;
}
export function parseBackendMemory(value: unknown): BackendMemoryContext {
  const r = exactRecord(value, ['facts', 'episodes', 'characterPreferences']);
  const facts = array(r.facts, 5).map(fact);
  if (new Set(facts.map(item => item.key)).size !== facts.length) throw new TypeError('Duplicate memory fact');
  const episodes = array(r.episodes, 2).map((value): BackendMemoryContext['episodes'][number] => {
    const e = exactRecord(value, ['kind', 'occurredAt'], ['userText', 'assistantText', 'outcome', 'executedMs']);
    const occurredAt = utc(e.occurredAt);
    if (e.kind === 'dialogue') {
      exactRecord(e, ['kind', 'occurredAt', 'userText', 'assistantText']);
      return { kind: 'dialogue', userText: plainText(e.userText, 240, true), assistantText: plainText(e.assistantText, 400, true), occurredAt };
    }
    exactRecord(e, ['kind', 'occurredAt', 'outcome', 'executedMs']); enumValue(e.kind, ['cursor_game']);
    return { kind: 'cursor_game', outcome: enumValue(e.outcome, ['caught', 'missed', 'lost_target', 'cancelled']), executedMs: finiteRange(e.executedMs, 60_000), occurredAt };
  });
  if (episodes.filter(item => item.kind === 'cursor_game').length > 1) throw new TypeError('Duplicate game');
  const characterPreferences = array(r.characterPreferences, 1).map(value => {
    const p = exactRecord(value, ['key', 'value', 'confidence']);
    if (typeof p.value !== 'number' || !Number.isFinite(p.value) || Math.abs(p.value) > 100) throw new TypeError('Invalid preference');
    const confidence = finiteRange(p.confidence, 1); if (confidence < 0.5) throw new TypeError('Unlearned preference');
    return { key: enumValue(p.key, ['activity.cursor_game']), value: p.value, confidence };
  });
  const result = { facts, episodes, characterPreferences };
  if (stringSize(result) > 2400) throw new TypeError('Memory text budget');
  return result;
}
export function projectBackendMemoryRequest(request: AIProviderRequest): BackendMemoryRequest {
  const base = projectBackendRequest(request);
  const memory = parseBackendMemory(request.memoryContext ?? { facts: [], episodes: [], characterPreferences: [] });
  let result: BackendMemoryRequest = { ...base, version: 2, memory };
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32 * 1024 && result.memory.episodes.length) {
    result = { ...result, memory: { ...result.memory, episodes: result.memory.episodes.slice(0, -1) } };
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32 * 1024) throw new TypeError('Request too large');
  return result;
}
function candidates(value: unknown, userText: string): readonly BackendMemoryCandidate[] | undefined {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  const keys = value.map(item => {
    try { const property = item && typeof item === 'object' ? Object.getOwnPropertyDescriptor(item, 'key') : undefined; return property && 'value' in property ? property.value : undefined; } catch { return undefined; }
  });
  return value.flatMap((value, index) => {
    try {
      const r = exactRecord(value, ['key', 'value', 'evidenceQuote']);
      if (keys.some((key, other) => other !== index && key === r.key)) return [];
      const parsed = fact({ key: r.key, value: r.value });
      const evidenceQuote = plainText(r.evidenceQuote, 240);
      if (evidenceQuote !== userText.trim()) return [];
      return [{ ...parsed, evidenceQuote }];
    } catch { return []; }
  });
}
export function parseBackendMemorySuccess(value: unknown, requestId: string, userText: string): BackendMemoryResponse {
  const r = exactRecord(value, ['version', 'requestId', 'text'], ['decision', 'memoryCandidates']);
  if (r.version !== 2) throw new TypeError('Invalid memory version');
  const base = parseBackendSuccess({ version: 1, requestId: r.requestId, text: r.text, ...(r.decision === undefined ? {} : { decision: r.decision }) }, requestId);
  const memoryCandidates = candidates(r.memoryCandidates, userText);
  return { ...base, version: 2, ...(memoryCandidates === undefined ? {} : { memoryCandidates }) };
}
export function parseBackendMemoryError(value: unknown, requestId: string, status: number): BackendMemoryErrorResponse {
  const r = exactRecord(value, ['version', 'requestId', 'error']);
  if (r.version !== 2) throw new TypeError('Invalid memory error version');
  return { ...parseBackendError({ ...r, version: 1 }, requestId, status), version: 2 };
}
