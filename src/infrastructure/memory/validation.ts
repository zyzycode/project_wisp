import type { CompletedChatTurn, ConversationSession, GameEpisode, JsonValue, PersistedCharacterStateSnapshot, PersistedChatMessage, UserFact } from '../../application/ports/memory-repository.interface';
import { plainText } from '../../shared/dialogue-ipc-validation';

export class MemoryDataError extends Error {
  constructor(readonly code: 'invalid_data' | 'conflict' | 'unsupported_version' | 'unavailable' | 'corrupt') { super(code); }
}
export function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MemoryDataError('invalid_data');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) throw new MemoryDataError('invalid_data');
  const result = value as Record<string, unknown>;
  if (Reflect.ownKeys(result).some(key => typeof key !== 'string' || !('value' in Object.getOwnPropertyDescriptor(result, key)!))) throw new MemoryDataError('invalid_data');
  if (keys && (Object.keys(result).length !== keys.length || keys.some(key => !Object.hasOwn(result, key)))) throw new MemoryDataError('invalid_data');
  return result;
}
export function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new MemoryDataError('invalid_data');
  return value;
}
export function timestamp(value: unknown): string {
  const result = text(value, 24);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result) throw new MemoryDataError('invalid_data');
  return result;
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new MemoryDataError('invalid_data');
  return value;
}
export function finite(value: unknown, min = 0, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new MemoryDataError('invalid_data');
  return value;
}
export function session(value: unknown): ConversationSession {
  const v = record(value, ['id', 'appRunId', 'startedAt', 'endedAt']);
  return { id: text(v.id), appRunId: text(v.appRunId), startedAt: timestamp(v.startedAt), endedAt: v.endedAt === null ? null : timestamp(v.endedAt) };
}
export function message(value: unknown): PersistedChatMessage {
  const v = record(value, ['id', 'conversationSessionId', 'role', 'content', 'createdAt']);
  if (v.role !== 'user' && v.role !== 'assistant') throw new MemoryDataError('invalid_data');
  return { id: text(v.id), conversationSessionId: text(v.conversationSessionId), role: v.role, content: plainText(v.content, v.role === 'user' ? 240 : 2000), createdAt: timestamp(v.createdAt) };
}
export function turn(value: unknown): CompletedChatTurn {
  const v = record(value, ['session', 'user', 'assistant']);
  const s = session(v.session), u = message(v.user), a = message(v.assistant);
  if (u.role !== 'user' || a.role !== 'assistant' || u.id === a.id || u.conversationSessionId !== s.id || a.conversationSessionId !== s.id || s.endedAt !== null) throw new MemoryDataError('invalid_data');
  return { session: s, user: { ...u, role: 'user' }, assistant: { ...a, role: 'assistant' } };
}
export function fact(value: unknown): UserFact {
  const v = record(value, ['id', 'factKey', 'factValue', 'confidence', 'sourceMessageId', 'createdAt', 'updatedAt']);
  return { id: text(v.id), factKey: text(v.factKey), factValue: text(v.factValue, 2000), confidence: finite(v.confidence, 0, 1), sourceMessageId: v.sourceMessageId === null ? null : text(v.sourceMessageId), createdAt: timestamp(v.createdAt), updatedAt: timestamp(v.updatedAt) };
}
export function episode(value: unknown): GameEpisode {
  const v = record(value, ['appRunId', 'activityRunId', 'kind', 'outcome', 'playCompleted', 'executedMs', 'endedAt']);
  if (v.kind !== 'cursor_game' || v.playCompleted !== true || (v.outcome !== 'caught' && v.outcome !== 'missed' && v.outcome !== 'lost_target' && v.outcome !== 'cancelled')) throw new MemoryDataError('invalid_data');
  return { appRunId: text(v.appRunId), activityRunId: text(v.activityRunId), kind: v.kind, outcome: v.outcome, playCompleted: true, executedMs: finite(v.executedMs), endedAt: timestamp(v.endedAt) };
}
function json(value: unknown, depth = 0): JsonValue {
  if (depth > 100) throw new MemoryDataError('invalid_data');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => json(item, depth + 1));
  const v = record(value);
  return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, json(item, depth + 1)]));
}
export function snapshot(value: unknown): PersistedCharacterStateSnapshot {
  const v = record(value, ['snapshotVersion', 'state', 'updatedAt']);
  const result = { snapshotVersion: integer(v.snapshotVersion, 1), state: json(v.state), updatedAt: timestamp(v.updatedAt) };
  if (Buffer.byteLength(JSON.stringify({ snapshotVersion: result.snapshotVersion, state: result.state }), 'utf8') > 1024 * 1024) throw new MemoryDataError('invalid_data');
  const state = result.state && typeof result.state === 'object' && !Array.isArray(result.state) ? record(result.state) : {};
  if (state.preferences !== undefined) {
    const preferences = record(state.preferences);
    if (Object.keys(preferences).length > 256) throw new MemoryDataError('invalid_data');
    for (const key of Object.keys(preferences)) text(key);
  }
  return result;
}
