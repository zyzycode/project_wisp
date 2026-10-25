import type { InterestThreadCommandDTO, InterestThreadDTO, InterestThreadRefDTO, InterestThreadResultDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './dialogue-ipc-validation';
import { memoryCardInteger, parseMemoryCardSource } from './memory-card-validation';
function id(value: unknown): string { const s = plainText(value, 128); if (s !== s.trim()) throw new TypeError('Invalid topic id'); return s; }
export function parseInterestThreadRef(value: unknown): InterestThreadRefDTO { const r = exactRecord(value, ['threadId', 'revision']); return { threadId: id(r.threadId), revision: memoryCardInteger(r.revision, 1) }; }
function date(value: unknown): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new TypeError('Invalid topic date'); return value; }
function quote(value: unknown): string { const s = plainText(value, 160); if (s !== s.trim() || /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(s)) throw new TypeError('Invalid topic quote'); return s; }
export function parseInterestThreadRead(value: unknown): { streamId: string } { const r = exactRecord(value, ['streamId']); return { streamId: id(r.streamId) }; }
export function parseInterestThreadCommand(value: unknown): InterestThreadCommandDTO {
  const r = exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected'], ['threadId', 'conversationId', 'source', 'text', 'confirmed', 'reason']);
  const base = { streamId: id(r.streamId), sequence: memoryCardInteger(r.sequence, 1), generation: memoryCardInteger(r.generation), commandId: id(r.commandId) };
  if (r.kind === 'confirm') {
    exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected', 'threadId', 'conversationId', 'source', 'text', 'confirmed']);
    if (r.confirmed !== true) throw new TypeError('Topic consent required');
    return { ...base, kind: 'confirm', expected: r.expected === null ? null : parseInterestThreadRef(r.expected), threadId: id(r.threadId), conversationId: id(r.conversationId), source: parseMemoryCardSource(r.source), text: quote(r.text), confirmed: true };
  }
  exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected', ...(r.kind === 'close' ? ['reason'] : [])]);
  const expected = parseInterestThreadRef(r.expected);
  if (r.kind === 'close') return { ...base, expected, kind: 'close', reason: enumValue(r.reason, ['declined', 'dismissed']) };
  return { ...base, expected, kind: enumValue(r.kind, ['delete']) };
}
export function parseInterestThread(value: unknown): InterestThreadDTO {
  const r = exactRecord(value, ['ref', 'state', 'text', 'confirmedAt', 'expiresAt', 'attempted']);
  const state = enumValue(r.state, ['unanswered', 'answered', 'closed']);
  if (typeof r.attempted !== 'boolean' || (state !== 'unanswered' && r.text !== null)) throw new TypeError('Invalid topic state');
  return { ref: parseInterestThreadRef(r.ref), state, text: state === 'unanswered' ? quote(r.text) : null, confirmedAt: date(r.confirmedAt), expiresAt: date(r.expiresAt), attempted: r.attempted };
}
function result<T>(value: unknown, parse: (value: unknown) => T): InterestThreadResultDTO<T> {
  const r = exactRecord(value, ['ok', 'generation'], ['value', 'code']); const generation = memoryCardInteger(r.generation);
  if (r.ok === false) { exactRecord(r, ['ok', 'generation', 'code']); return { ok: false, generation, code: enumValue(r.code, ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'invalid_data', 'conflict', 'stale', 'io_error']) }; }
  exactRecord(r, ['ok', 'generation', 'value']); if (r.ok !== true) throw new TypeError('Invalid topic result'); return { ok: true, generation, value: parse(r.value) };
}
export const parseInterestThreadReadResult = (value: unknown) => result(value, v => v === null ? null : parseInterestThread(v));
export const parseInterestThreadMutationResult = (value: unknown) => result(value, v => {
  const r = exactRecord(v, ['commandId', 'ref', 'outcome']); return { commandId: id(r.commandId), ref: parseInterestThreadRef(r.ref), outcome: enumValue(r.outcome, ['unanswered', 'answered', 'closed', 'deleted']) };
});
