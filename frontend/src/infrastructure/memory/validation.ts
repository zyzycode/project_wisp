import { beverageUse, beverageCorrection } from './beverage-validation';
import { topicUse } from './interest-thread-validation';
import type { CompletedChatTurn, ConversationSession, GameEpisode, JsonValue, PersistedCharacterStateSnapshot, PersistedChatMessage, UserFact } from '../../application/ports/memory-repository.interface';
import { plainText } from '../../shared/dialogue-ipc-validation';

import { MemoryDataError, record, text, timestamp, integer, finite } from './validation-primitives';
export { MemoryDataError, record, text, timestamp, integer, finite } from './validation-primitives';

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
  const raw = record(value);
  const v = record(value, ['session', 'user', 'assistant', ...(Object.hasOwn(raw, 'memoryConfirmable') ? ['memoryConfirmable'] : []), ...(Object.hasOwn(raw, 'interestThread') ? ['interestThread'] : []), ...['lifeDerivedUse','beverageUse','beverageCorrection','beverageProposalSource'].filter(key => Object.hasOwn(raw,key))]);
  if (v.memoryConfirmable !== undefined && typeof v.memoryConfirmable !== 'boolean') throw new MemoryDataError('invalid_data');
  if (Object.hasOwn(raw,'beverageProposalSource') && v.beverageProposalSource !== true) throw new MemoryDataError('invalid_data');
  let lifeDerivedUse: CompletedChatTurn['lifeDerivedUse'];
  if (Object.hasOwn(raw, 'lifeDerivedUse')) {
    const rawUse = record(v.lifeDerivedUse);
    const use = record(v.lifeDerivedUse, ['requestId','userMessageId','origin', ...(Object.hasOwn(rawUse,'musicIntention') ? ['musicIntention'] : [])]);
    if (use.origin !== 'reflection' && use.origin !== 'life_summary' && use.origin !== 'music_topic') throw new MemoryDataError('invalid_data');
    if (Object.hasOwn(rawUse,'musicIntention') && (use.origin !== 'music_topic' || use.musicIntention !== 'ask_music_detail')) throw new MemoryDataError('invalid_data');
    lifeDerivedUse = { requestId: text(use.requestId), userMessageId: text(use.userMessageId), origin: use.origin, ...(use.musicIntention === 'ask_music_detail' ? { musicIntention: 'ask_music_detail' as const } : {}) };
  }
  const s = session(v.session), u = message(v.user), a = message(v.assistant);
  if (u.role !== 'user' || a.role !== 'assistant' || u.id === a.id || u.conversationSessionId !== s.id || a.conversationSessionId !== s.id || s.endedAt !== null) throw new MemoryDataError('invalid_data');
  return { ...(lifeDerivedUse ? { lifeDerivedUse } : {}), ...(v.beverageProposalSource === true ? { beverageProposalSource: true as const } : {}), ...(Object.hasOwn(raw,'beverageUse') ? { beverageUse: beverageUse(v.beverageUse) } : {}), ...(Object.hasOwn(raw,'beverageCorrection') ? { beverageCorrection: beverageCorrection(v.beverageCorrection) } : {}), ...(Object.hasOwn(raw, 'interestThread') ? { interestThread: topicUse(v.interestThread) } : {}), ...(v.memoryConfirmable === undefined ? {} : { memoryConfirmable: v.memoryConfirmable }), session: s, user: { ...u, role: 'user' }, assistant: { ...a, role: 'assistant' } };
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

/** Active writer accepts v6 only; load preserves unknown envelopes for Application. */
export function writableSnapshot(value: unknown): PersistedCharacterStateSnapshot {
  const result = snapshot(value);
  if (result.snapshotVersion !== 6) throw new MemoryDataError('invalid_data');
  return result;
}
