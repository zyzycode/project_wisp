import { expect, it, vi } from 'vitest';
import { MemoryFactsReader } from '../../src/application/services/memory-facts-reader';
import type { IUserMemoryFactsReader, UserMemoryFact } from '../../src/application/ports/memory-knowledge.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { parseMemoryFactsRead, parseMemoryFactsResult } from '../../src/shared/memory-facts-validation';
it('bounds pending reads for the lifetime and discards late results even when the stream ID is reused', async () => {
  let resolve!: (result: MemoryResult<readonly UserMemoryFact[]>) => void;
  const runtime: IUserMemoryFactsReader = { readFacts: vi.fn<IUserMemoryFactsReader['readFacts']>(() => new Promise(yes => { resolve = yes; })) };
  const reader = new MemoryFactsReader(() => runtime); reader.replaceStream('s');
  const reading = reader.read({ streamId: 's' });
  expect(await reader.read({ streamId: 's' })).toEqual({ ok: false, code: 'busy' });
  reader.replaceStream('s');
  expect(await reader.read({ streamId: 's' })).toEqual({ ok: false, code: 'busy' });
  resolve({ ok: true, value: [{ key: 'user.display_name', value: 'Old' }] });
  expect(await reading).toEqual({ ok: false, code: 'stale' });
  expect(runtime.readFacts).toHaveBeenCalledTimes(1);
});
it('does not admit unknown streams, converts rejected reads and releases admission', async () => {
  const runtime = { readFacts: vi.fn<IUserMemoryFactsReader['readFacts']>().mockRejectedValueOnce(new Error('private')).mockResolvedValue({ ok: true, value: [] }) };
  const reader = new MemoryFactsReader(() => runtime); reader.replaceStream('s');
  expect(await reader.read({ streamId: 'old' })).toEqual({ ok: false, code: 'stale' }); expect(runtime.readFacts).not.toHaveBeenCalled();
  expect(await reader.read({ streamId: 's' })).toEqual({ ok: false, code: 'unavailable' });
  expect(await reader.read({ streamId: 's' })).toEqual({ ok: true, facts: [] });
});
it('requires an exact request and bounded allowlisted result without private fields', () => {
  expect(parseMemoryFactsRead({ streamId: 's' })).toEqual({ streamId: 's' });
  for (const value of [{ streamId: ' s' }, { streamId: 's', generation: 0 }, { streamId: '' }, { streamId: 's'.repeat(129) }]) expect(() => parseMemoryFactsRead(value)).toThrow();
  expect(parseMemoryFactsResult({ ok: true, facts: [{ key: 'user.favorite_topic', value: 'T'.repeat(120) }, { key: 'user.reply_style', value: 'detailed' }, { key: 'user.cursor_game', value: 'dislike' }] })).toMatchObject({ ok: true });
  const fact = { key: 'user.display_name', value: 'A'.repeat(80) };
  expect(parseMemoryFactsResult({ ok: true, facts: [fact] })).toEqual({ ok: true, facts: [fact] });
  for (const facts of [[{ ...fact, value: 'A'.repeat(81) }], [{ key: 'user.favorite_topic', value: 'A'.repeat(121) }], [{ key: 'user.explore', value: 'like' }], [{ key: 'user.reply_style', value: 'verbose' }], [{ key: 'user.cursor_game', value: 'maybe' }], [fact, fact], Array.from({ length: 6 }, () => fact), [{ ...fact, sourceMessageId: 'secret' }], [{ ...fact, value: '\u0000' }]]) expect(() => parseMemoryFactsResult({ ok: true, facts })).toThrow();
  for (const value of [{ ok: true, facts: [], generation: 0 }, { ok: false, code: 'SQLITE' }, { ok: false, code: 'io_error', facts: [] }]) expect(() => parseMemoryFactsResult(value)).toThrow();
});
