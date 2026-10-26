import type { MemoryCardCommandDTO, MemoryCardContentDTO, MemoryCardDTO, MemoryCardFailureDTO, MemoryCardListCommandDTO, MemoryCardListResultDTO, MemoryCardResultDTO, MemoryCardSourceDTO } from './ipc-contracts';
import { exactRecord, plainText } from './validation-primitives';
function text(value: unknown, max = 128): string { return plainText(value, max); }
export function memoryCardInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new TypeError('Invalid memory card'); return value; }
export function parseMemoryCardContent(input: unknown): MemoryCardContentDTO {
  const r = exactRecord(input, ['category', 'label', 'text', 'occurredOn']);
  if (r.category !== 'important_event' && r.category !== 'shared_joke') throw new TypeError('Invalid memory category');
  if (r.occurredOn !== null && (typeof r.occurredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.occurredOn) || !Number.isFinite(Date.parse(r.occurredOn)) || new Date(r.occurredOn).toISOString().slice(0, 10) !== r.occurredOn)) throw new TypeError('Invalid memory date');
  return { category: r.category, label: text(r.label, 80), text: text(r.text, 400), occurredOn: r.occurredOn };
}
export function parseMemoryCardSource(input: unknown): MemoryCardSourceDTO {
  const r = exactRecord(input, ['userMessageId', 'assistantMessageId']);
  const source = { userMessageId: text(r.userMessageId), assistantMessageId: text(r.assistantMessageId) };
  if (source.userMessageId === source.assistantMessageId) throw new TypeError('Invalid memory source'); return source;
}
export function parseMemoryCardCommand(input: unknown): MemoryCardCommandDTO {
  const base = exactRecord(input, ['streamId', 'sequence', 'commandId', 'generation', 'itemId', 'expectedRevision', 'kind'], ['confirmed', 'content', 'source']);
  const envelope = { streamId: text(base.streamId), sequence: memoryCardInteger(base.sequence, 1), commandId: text(base.commandId), generation: memoryCardInteger(base.generation), itemId: text(base.itemId), expectedRevision: memoryCardInteger(base.expectedRevision) };
  if (base.kind === 'confirm' || base.kind === 'update') {
    if (base.confirmed !== true || (base.kind === 'confirm' ? envelope.expectedRevision !== 0 : envelope.expectedRevision < 1)) throw new TypeError('Invalid memory confirmation');
    return { ...envelope, kind: base.kind, confirmed: true, content: parseMemoryCardContent(base.content), source: parseMemoryCardSource(base.source) };
  }
  exactRecord(input, ['streamId', 'sequence', 'commandId', 'generation', 'itemId', 'expectedRevision', 'kind']);
  if ((base.kind !== 'withdraw' && base.kind !== 'delete') || envelope.expectedRevision < 1) throw new TypeError('Invalid memory mutation');
  return { ...envelope, kind: base.kind };
}
export function parseMemoryCardListCommand(input: unknown): MemoryCardListCommandDTO {
  const r = exactRecord(input, ['streamId', 'cursor', 'limit']);
  return { streamId: text(r.streamId), cursor: r.cursor === null ? null : memoryCardInteger(r.cursor, 1), limit: memoryCardInteger(r.limit, 1, 20) };
}
export function parseMemoryCard(input: unknown): MemoryCardDTO {
  const r = exactRecord(input, ['id', 'revision', 'status', 'category', 'label', 'text', 'occurredOn', 'confirmedAt', 'source']);
  if (r.status !== 'active' && r.status !== 'withdrawn') throw new TypeError('Invalid memory status');
  if (typeof r.confirmedAt !== 'string' || !Number.isFinite(Date.parse(r.confirmedAt)) || new Date(r.confirmedAt).toISOString() !== r.confirmedAt) throw new TypeError('Invalid memory confirmation date');
  return { ...parseMemoryCardContent({ category: r.category, label: r.label, text: r.text, occurredOn: r.occurredOn }), id: text(r.id), revision: memoryCardInteger(r.revision, 1), status: r.status, confirmedAt: r.confirmedAt, source: parseMemoryCardSource(r.source) };
}
function failure(value: unknown): MemoryCardFailureDTO {
  const codes: readonly MemoryCardFailureDTO[] = ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'invalid_data', 'conflict', 'stale', 'io_error'];
  if (!codes.some(code => code === value)) throw new TypeError('Invalid memory failure'); return value as MemoryCardFailureDTO;
}
export function parseMemoryCardResult(input: unknown): MemoryCardResultDTO {
  const r = exactRecord(input, ['ok', 'generation'], ['receipt', 'code']); const generation = memoryCardInteger(r.generation);
  if (r.ok === false) { exactRecord(input, ['ok', 'generation', 'code']); return { ok: false, generation, code: failure(r.code) }; }
  if (r.ok !== true) throw new TypeError('Invalid memory result'); exactRecord(input, ['ok', 'generation', 'receipt']);
  const p = exactRecord(r.receipt, ['commandId', 'itemId', 'revision', 'outcome']);
  if (p.outcome !== 'active' && p.outcome !== 'withdrawn' && p.outcome !== 'deleted') throw new TypeError('Invalid memory receipt');
  return { ok: true, generation, receipt: { commandId: text(p.commandId), itemId: text(p.itemId), revision: memoryCardInteger(p.revision, 1), outcome: p.outcome } };
}
export function parseMemoryCardListResult(input: unknown): MemoryCardListResultDTO {
  const r = exactRecord(input, ['ok', 'generation'], ['items', 'nextCursor', 'code']); const generation = memoryCardInteger(r.generation);
  if (r.ok === false) { exactRecord(input, ['ok', 'generation', 'code']); return { ok: false, generation, code: failure(r.code) }; }
  exactRecord(input, ['ok', 'generation', 'items', 'nextCursor']);
  if (r.ok !== true || !Array.isArray(r.items) || r.items.length > 20) throw new TypeError('Invalid memory page');
  return { ok: true, generation, items: r.items.map(parseMemoryCard), nextCursor: r.nextCursor === null ? null : memoryCardInteger(r.nextCursor, 1) };
}
