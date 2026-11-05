import type { MemoryItemMutation, MemoryItemPage, MemoryItemReceipt, MemoryItemRecallPage } from '../../application/ports/memory-items.interface';
import { memoryCardInteger, parseMemoryCard, parseMemoryCardCommand, parseMemoryCardResult } from '../../shared/memory-card-validation';
import { record, timestamp, integer, MemoryDataError } from './validation';
export function itemRecallTokens(input: unknown): readonly string[] {
  if (!Array.isArray(input) || input.length > 8 || new Set(input).size !== input.length
    || input.some(token => typeof token !== 'string' || !/^[\p{L}\p{N}]{2,64}$/u.test(token) || token !== token.normalize('NFC').toLowerCase())) throw new MemoryDataError('invalid_data');
  return input as readonly string[];
}
export function itemCandidates(input: unknown): MemoryItemRecallPage {
  const r = record(input, ['candidates', 'coverage', 'examined', 'fetched']);
  if (!Array.isArray(r.candidates) || r.candidates.length > 96 || (r.coverage !== 'complete' && r.coverage !== 'index_building')) throw new MemoryDataError('invalid_data');
  return { candidates: r.candidates.map(value => {
    const c = record(value, ['item', 'score', 'labelMatches', 'confirmationOrder']);
    return { item: parseMemoryCard(c.item), score: integer(c.score, 1, 8), labelMatches: integer(c.labelMatches, 0, 8), confirmationOrder: integer(c.confirmationOrder, 1) };
  }), coverage: r.coverage, examined: integer(r.examined, 0, 96), fetched: integer(r.fetched, 0, 96) };
}
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
