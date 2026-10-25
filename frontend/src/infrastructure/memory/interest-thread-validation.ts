import type { AIProviderDialogueTopic, InterestThread, InterestThreadCapture, InterestThreadMutation, InterestThreadReceipt, InterestThreadRef, InterestThreadTurnUse } from '../../application/ports/interest-thread.interface';
import { enumValue, plainText } from '../../shared/dialogue-ipc-validation';
import * as v from './validation';

function id(input: unknown): string { const s = plainText(input, 128); if (s !== s.trim()) throw new v.MemoryDataError('invalid_data'); return s; }
export function topicText(input: unknown): string {
  const s = plainText(input, 160); if (s !== s.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(s) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)) throw new v.MemoryDataError('invalid_data'); return s;
}
export function topicRef(input: unknown): InterestThreadRef { const r = v.record(input, ['threadId', 'revision']); return { threadId: id(r.threadId), revision: v.integer(r.revision, 1) }; }
export function topicSource(input: unknown): { userMessageId: string; assistantMessageId: string } {
  const r = v.record(input, ['userMessageId', 'assistantMessageId']);
  const userMessageId = id(r.userMessageId), assistantMessageId = id(r.assistantMessageId);
  if (userMessageId === assistantMessageId) throw new v.MemoryDataError('invalid_data'); return { userMessageId, assistantMessageId };
}
export function topicUse(input: unknown): InterestThreadTurnUse {
  const r = v.record(input, ['ref', 'requestId', 'userMessageId', 'mode']);
  return { ref: topicRef(r.ref), requestId: id(r.requestId), userMessageId: id(r.userMessageId), mode: enumValue(r.mode, ['follow_up', 'reply']) };
}
export function topicMutation(input: unknown): InterestThreadMutation {
  const r = v.record(input); const kind = enumValue(r.kind, ['confirm', 'close', 'delete']);
  const commandId = id(r.commandId);
  if (kind === 'confirm') {
    v.record(r, ['kind', 'commandId', 'threadId', 'expected', 'confirmed', 'source', 'text', 'confirmedAt']);
    if (r.confirmed !== true) throw new v.MemoryDataError('invalid_data');
    return { kind, commandId, threadId: id(r.threadId), expected: r.expected === null ? null : topicRef(r.expected), confirmed: true, source: topicSource(r.source), text: topicText(r.text), confirmedAt: v.timestamp(r.confirmedAt) };
  }
  v.record(r, kind === 'close' ? ['kind', 'commandId', 'expected', 'reason'] : ['kind', 'commandId', 'expected']);
  const common = { kind, commandId, expected: topicRef(r.expected) };
  return kind === 'delete' ? { ...common, kind } : { ...common, kind, reason: enumValue(r.reason, ['declined', 'dismissed', 'expired', 'source_changed']) };
}
export function topicReservation(input: unknown): { expected: InterestThreadRef; requestId: string; userMessageId: string; now: string } {
  const r = v.record(input, ['expected', 'requestId', 'userMessageId', 'now']);
  return { expected: topicRef(r.expected), requestId: id(r.requestId), userMessageId: id(r.userMessageId), now: v.timestamp(r.now) };
}
export function topicReceipt(input: unknown): InterestThreadReceipt {
  const r = v.record(input, ['commandId', 'ref', 'outcome']);
  return { commandId: id(r.commandId), ref: topicRef(r.ref), outcome: enumValue(r.outcome, ['unanswered', 'answered', 'closed', 'deleted']) };
}
export function topic(input: unknown): InterestThread {
  const r = v.record(input); const state = enumValue(r.state, ['unanswered', 'answered', 'closed']);
  v.record(r, ['ref', 'source', 'statedAt', 'confirmedAt', 'eligibleAt', 'expiresAt', 'attempt', 'state', 'text', ...(state === 'answered' ? ['answerSource'] : state === 'closed' ? ['reason'] : [])]);
  let attempt = null;
  if (r.attempt !== null) { const a = v.record(r.attempt, ['requestId', 'userMessageId', 'attemptedAt']); attempt = { requestId: id(a.requestId), userMessageId: id(a.userMessageId), attemptedAt: v.timestamp(a.attemptedAt) }; }
  const base = { ref: topicRef(r.ref), source: topicSource(r.source), statedAt: v.timestamp(r.statedAt), confirmedAt: v.timestamp(r.confirmedAt), eligibleAt: v.timestamp(r.eligibleAt), expiresAt: v.timestamp(r.expiresAt), attempt };
  if (Date.parse(base.eligibleAt) !== Date.parse(base.confirmedAt) + 86400000 || Date.parse(base.expiresAt) !== Date.parse(base.confirmedAt) + 7 * 86400000) throw new v.MemoryDataError('invalid_data');
  if (state === 'unanswered') return { ...base, state, text: topicText(r.text) };
  if (r.text !== null) throw new v.MemoryDataError('invalid_data');
  return state === 'answered' ? { ...base, state, text: null, answerSource: topicSource(r.answerSource) } : { ...base, state, text: null, reason: enumValue(r.reason, ['declined', 'dismissed', 'expired', 'source_changed']) };
}
export function topicRead(input: unknown): { thread: InterestThread | null; sourceValid: boolean } {
  const r = v.record(input, ['thread', 'sourceValid']); if (typeof r.sourceValid !== 'boolean') throw new v.MemoryDataError('invalid_data');
  return { thread: r.thread === null ? null : topic(r.thread), sourceValid: r.sourceValid };
}
export function topicCapture(input: unknown): InterestThreadCapture | null {
  if (input === null) return null; const r = v.record(input, ['use', 'topic', 'expiresAt', 'generation']);
  const t = v.record(r.topic, ['mode', 'text', 'statedAt']);
  const projection: AIProviderDialogueTopic = { mode: enumValue(t.mode, ['follow_up', 'reply']), text: topicText(t.text), statedAt: v.timestamp(t.statedAt) };
  const use = topicUse(r.use); if (use.mode !== projection.mode) throw new v.MemoryDataError('invalid_data');
  return { use, topic: projection, expiresAt: v.timestamp(r.expiresAt), generation: v.integer(r.generation) };
}
