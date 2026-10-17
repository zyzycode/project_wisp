import { expect, it } from 'vitest';
import { parseMemoryCardCommand, parseMemoryCardContent, parseMemoryCardListCommand, parseMemoryCardListResult, parseMemoryCardResult } from '../../src/shared/memory-card-validation';
const content = { category: 'shared_joke', label: 'Шутка', text: '«Я король Луны»', occurredOn: null };
const source = { userMessageId: 'user', assistantMessageId: 'assistant' };
const command = { kind: 'confirm', streamId: 'stream', sequence: 1, commandId: 'command', generation: 0, itemId: 'item', expectedRevision: 0, confirmed: true, content, source };
it('requires an explicit confirmation with exact source and does not infer dates from quoted text', () => {
  expect(parseMemoryCardCommand(command)).toEqual(command);
  expect(parseMemoryCardContent({ ...content, text: '«Встречаемся завтра»' }).occurredOn).toBeNull();
  for (const change of [{ confirmed: false }, { confirmed: undefined }, { evidenceQuote: content.text }, { providerConfirmed: true },
    { source: { ...source, provider: 'model' } }, { source: { userMessageId: 'same', assistantMessageId: 'same' } },
    { expectedRevision: 1 }, { generation: -1 }, { sequence: 0 }, { content: { ...content, category: 'diagnosis' } }]) {
    expect(() => parseMemoryCardCommand({ ...command, ...change })).toThrow();
  }
});
it('bounds content and validates actual calendar dates without normalization', () => {
  for (const change of [{ label: '' }, { label: 'x'.repeat(81) }, { text: 'x'.repeat(401) },
    { occurredOn: '2026-02-29' }, { occurredOn: '2026-02-30' }, { occurredOn: '2026-1-01' }, { occurredOn: '2026-10-17T00:00:00Z' }]) {
    expect(() => parseMemoryCardContent({ ...content, ...change })).toThrow();
  }
  expect(parseMemoryCardContent({ ...content, occurredOn: '2024-02-29' }).occurredOn).toBe('2024-02-29');
});
it('validates mutation variants, bounded pages, failure codes and exact receipts', () => {
  const { confirmed: _confirmed, content: _content, source: _source, ...base } = command;
  expect(parseMemoryCardCommand({ ...base, kind: 'withdraw', expectedRevision: 1 }).kind).toBe('withdraw');
  expect(() => parseMemoryCardCommand({ ...command, kind: 'delete', expectedRevision: 1 })).toThrow();
  for (const limit of [0, 21, 1.5]) expect(() => parseMemoryCardListCommand({ streamId: 's', cursor: null, limit })).toThrow();
  expect(parseMemoryCardListResult({ ok: true, generation: 1, items: [], nextCursor: null })).toMatchObject({ items: [] });
  expect(() => parseMemoryCardListResult({ ok: true, generation: 1, items: [], nextCursor: 0 })).toThrow();
  expect(() => parseMemoryCardListResult({ ok: true, generation: 1, items: Array(21).fill({}), nextCursor: null })).toThrow();
  expect(parseMemoryCardResult({ ok: false, generation: 1, code: 'unavailable' })).toMatchObject({ ok: false });
  expect(() => parseMemoryCardResult({ ok: false, generation: 1, code: 'private path' })).toThrow();
  expect(() => parseMemoryCardResult({ ok: true, generation: 1, receipt: { commandId: 'c', itemId: 'i', revision: 1, outcome: 'active', private: true } })).toThrow();
});
