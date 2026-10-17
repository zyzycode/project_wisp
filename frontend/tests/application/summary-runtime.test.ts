import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { SummaryRuntime } from '../../src/application/services/summary-runtime';
import { selectSummaryPairs } from '../../src/application/services/summary-selection';
import type { ISummaryCache, SummaryCache, SummaryPair, SummarySourceSnapshot } from '../../src/application/ports/summary';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const pair = (n: number, userText = `Тема космос ${n}`): SummaryPair => ({ userMessageId: `u${n}`, assistantMessageId: `a${n}`, sessionId: 's', userText, assistantText: 'Обсудили космос.', eligible: true });
function fixture(interruptObservation?: () => Promise<void>) {
  let stored: SummaryCache = { formatVersion: 1, entry: null, receipt: null }, epoch = 0, generation = 0;
  let snapshot: SummarySourceSnapshot = { pairs: Array.from({ length: 11 }, (_, n) => pair(n)), facts: [] };
  const write = vi.fn<ISummaryCache['write']>(async (value, g) => { if (g !== epoch) return { ok: false, code: 'stale' }; stored = value; return { ok: true, value: undefined }; });
  const cache: ISummaryCache = { read: async () => ({ ok: true, value: stored }), write, invalidate: () => ++epoch, clear: async reset => { epoch++; stored = { ...stored, entry: null, receipt: reset ? null : stored.receipt }; return { ok: true, value: undefined }; }, dispose: () => { epoch++; } };
  const generateSummary = vi.fn(async () => 'Пользователь обсуждал космос.');
  const recent = vi.fn(async () => ({ ok: true as const, value: snapshot }));
  const exact = vi.fn(async (sources: readonly { userMessageId: string }[]) => ({ ok: true as const, value: { ...snapshot, pairs: snapshot.pairs.filter(p => sources.some(s => s.userMessageId === p.userMessageId)) } }));
  const options = { ...(interruptObservation ? { interruptObservation } : {}), cache, generator: { generateSummary }, sources: { recent, exact }, context: () => ({ generation }), now: Date.now, createId: randomUUID, hash, scheduler: { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) }, locale: 'ru' as const, beforeRead: async () => {}, canGenerate: () => true };
  const runtime = new SummaryRuntime(options);
  return { runtime, options, cache, write, generateSummary, recent, exact, stored: () => stored, mutate: (pairs: readonly SummaryPair[]) => { snapshot = { ...snapshot, pairs }; }, generation: () => generation++, facts: () => { snapshot = { ...snapshot, facts: [{ id: 'f', factKey: 'user.display_name', factValue: 'Мария', confidence: 1, sourceMessageId: null, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' }] }; } };
}
async function preview(f: ReturnType<typeof fixture>) { const p = await f.runtime.preview(); if (!p.ok) throw new Error(p.code); return p.value; }
afterEach(() => vi.useRealTimers());
it('selects contiguous latest 4–8 pairs outside three volatile pairs and all registry/correction sources', () => {
  const all = Array.from({ length: 15 }, (_, n) => pair(n));
  expect(selectSummaryPairs(all)).toEqual(all.slice(4, 12));
  for (const text of ['Correction: cosmos', 'Forget space', 'Меня зовут Аня', 'Забудь космос']) {
    const changed = [...all]; changed[8] = pair(8, text); expect(selectSummaryPairs(changed)).toEqual(all.slice(0, 8));
  }
  const huge = all.map(p => ({ ...p, assistantText: 'x'.repeat(2000) })); expect(selectSummaryPairs(huge)).toEqual([]);
});
it('explicit confirmation writes receipt before one inference, joins repeats, reuses cache and never generates on capture/restart', async () => {
  const f = fixture(), p = await preview(f); expect(p.pairs).toHaveLength(8); expect(f.generateSummary).not.toHaveBeenCalled();
  f.generateSummary.mockImplementation(async () => { expect(f.stored().receipt).not.toBeNull(); return 'Космос обсуждался.'; });
  const command = randomUUID(); const first = f.runtime.confirm(command, p.previewId), repeat = f.runtime.confirm(command, p.previewId);
  expect(first).toBe(repeat); expect(await first).toMatchObject({ ok: true }); expect(f.generateSummary).toHaveBeenCalledTimes(1);
  expect(await f.runtime.confirm(command, 'different')).toEqual({ ok: false, code: 'conflict' });
  const p2 = await preview(f); expect(await f.runtime.confirm(randomUUID(), p2.previewId)).toMatchObject({ ok: true }); expect(f.generateSummary).toHaveBeenCalledTimes(1);
  const restarted = new SummaryRuntime(f.options); expect(await restarted.capture('Космос')).toMatchObject({ text: 'Космос обсуждался.', excludedMessageIds: expect.arrayContaining(['u0', 'a7']) });
  expect(await restarted.capture('другое')).toBeUndefined(); expect(f.generateSummary).toHaveBeenCalledTimes(1);
});
it('stale sources/facts and TTL fail before inference and old cache cannot enrich a request', async () => {
  vi.useFakeTimers(); const f = fixture(), p = await preview(f); f.facts();
  expect(await f.runtime.confirm(randomUUID(), p.previewId)).toEqual({ ok: false, code: 'stale' }); expect(f.generateSummary).not.toHaveBeenCalled();
  const fresh = await preview(f); await vi.advanceTimersByTimeAsync(120000); expect(await f.runtime.confirm(randomUUID(), fresh.previewId)).toEqual({ ok: false, code: 'stale' });
});
it.each(['interrupt', 'invalidate', 'dispose', 'reset', 'deleteSummary'] as const)('%s discards late generation and retains receipt except full reset', async action => {
  const f = fixture(); let resolve!: (text: string) => void; f.generateSummary.mockImplementation(() => new Promise(r => { resolve = r; }));
  const p = await preview(f), pending = f.runtime.confirm(randomUUID(), p.previewId);
  await vi.waitFor(() => expect(f.generateSummary).toHaveBeenCalledTimes(1)); await f.runtime[action](); resolve('Космос устарел');
  expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.stored().entry).toBeNull(); expect(f.stored().receipt === null).toBe(action === 'reset');
});
it('failed provider attempt, delete and clock rollback do not reset rolling24h admission', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100000000); const f = fixture(); f.generateSummary.mockRejectedValue(new Error('offline'));
  const p = await preview(f); expect(await f.runtime.confirm(randomUUID(), p.previewId)).toEqual({ ok: false, code: 'failed' });
  await f.runtime.deleteSummary(); vi.setSystemTime(1); const p2 = await preview(f);
  expect(await f.runtime.confirm(randomUUID(), p2.previewId)).toEqual({ ok: false, code: 'rate_limited' }); expect(f.generateSummary).toHaveBeenCalledTimes(1);
});
it('receipt write failure prevents any dispatch; timeout and late exact read cannot publish cache', async () => {
  const f = fixture(), p = await preview(f); f.write.mockResolvedValue({ ok: false, code: 'io_error' });
  expect(await f.runtime.confirm(randomUUID(), p.previewId)).toEqual({ ok: false, code: 'unavailable' }); expect(f.generateSummary).not.toHaveBeenCalled();
  vi.useFakeTimers(); const g = fixture(); g.exact.mockImplementation(() => new Promise(() => {})); const q = await preview(g);
  const pending = g.runtime.confirm(randomUUID(), q.previewId); await vi.advanceTimersByTimeAsync(200); expect(await pending).toEqual({ ok: false, code: 'failed' }); expect(g.generateSummary).not.toHaveBeenCalled();
});
it('source edits, suppression and scalar correction reject a previously valid cache on capture', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.facts(), (f: ReturnType<typeof fixture>) => f.mutate([pair(0)])]) {
    const f = fixture(), p = await preview(f); await f.runtime.confirm(randomUUID(), p.previewId); mutate(f); expect(await f.runtime.capture('космос')).toBeUndefined();
  }
});
it('persisted failed command remains once-only after restart and24h; a new explicit command is required', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100000000); const f = fixture(); const commandId = randomUUID();
  f.generateSummary.mockRejectedValue(new Error('offline')); const p = await preview(f);
  expect(await f.runtime.confirm(commandId, p.previewId)).toEqual({ ok: false, code: 'failed' });
  await vi.advanceTimersByTimeAsync(86400001);
  const restarted = new SummaryRuntime(f.options), p2 = await restarted.preview(); if (!p2.ok) throw new Error(p2.code);
  expect(await restarted.confirm(commandId, p2.value.previewId)).toEqual({ ok: false, code: 'failed' });
  expect(f.generateSummary).toHaveBeenCalledTimes(1);
});

it('explicit summary confirmation preempts observation and waits for settlement within its deadline', async () => {
  let settle!: () => void; const interlock = vi.fn(() => new Promise<void>(resolve => { settle = resolve; }));
  const f = fixture(interlock), p = await preview(f); expect(interlock).not.toHaveBeenCalled();
  const pending = f.runtime.confirm(randomUUID(), p.previewId); expect(interlock).toHaveBeenCalledTimes(1);
  expect(f.generateSummary).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
  settle(); expect(await pending).toMatchObject({ ok: true }); expect(f.generateSummary).toHaveBeenCalledTimes(1);
});
it('summary interrupted during observation drain never writes receipt or dispatches later', async () => {
  let settle!: () => void; const f = fixture(() => new Promise<void>(resolve => { settle = resolve; })), p = await preview(f);
  const pending = f.runtime.confirm(randomUUID(), p.previewId); f.runtime.interrupt(); settle();
  expect(await pending).toMatchObject({ ok: false, code: 'stale' }); expect(f.generateSummary).not.toHaveBeenCalled(); expect(f.write).not.toHaveBeenCalled();
});
