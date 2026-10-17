import type { MemoryItemMutation, MemoryItemPage, MemoryItemReceipt } from '../../application/ports/memory-items.interface';
import { memoryCardInteger, parseMemoryCard, parseMemoryCardCommand, parseMemoryCardResult } from '../../shared/memory-card-validation';
import { record, timestamp, MemoryDataError } from './validation';
export function itemMutation(input: unknown): MemoryItemMutation {
  const r = record(input);
  const { confirmedAt, ...rest } = r;
  const c = parseMemoryCardCommand({ ...rest, streamId: 'worker', sequence: 1, generation: 0 });
  const common = { commandId: c.commandId, itemId: c.itemId, expectedRevision: c.expectedRevision };
  if (c.kind === 'confirm') return { ...common, expectedRevision: 0, kind: 'confirm', confirmed: true, content: c.content, source: c.source, confirmedAt: timestamp(confirmedAt) };
  if (c.kind === 'update') return { ...common, kind: 'update', confirmed: true, content: c.content, source: c.source, confirmedAt: timestamp(confirmedAt) };
  if (confirmedAt !== undefined) throw new MemoryDataError('invalid_data');
  return { ...common, kind: c.kind };
}
export function itemListQuery(input: unknown): { cursor: number | null; limit: number } {
  const r = record(input, ['cursor', 'limit']);
  return { cursor: r.cursor === null ? null : memoryCardInteger(r.cursor, 1), limit: memoryCardInteger(r.limit, 1, 20) };
}
export function itemPage(input: unknown): MemoryItemPage {
  const r = record(input, ['items', 'nextCursor']);
  if (!Array.isArray(r.items) || r.items.length > 20) throw new MemoryDataError('invalid_data');
  return { items: r.items.map(parseMemoryCard), nextCursor: r.nextCursor === null ? null : memoryCardInteger(r.nextCursor, 1) };
}
export function itemReceipt(input: unknown): MemoryItemReceipt {
  const result = parseMemoryCardResult({ ok: true, generation: 0, receipt: input });
  if (!result.ok) throw new MemoryDataError('invalid_data'); return result.receipt;
}
