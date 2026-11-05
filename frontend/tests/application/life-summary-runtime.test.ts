import type { ILifeHistoryReader } from '../../src/application/ports/life-history.interface';
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { SummaryRuntime } from '../../src/application/services/summary-runtime';
import { selectLifeSummary } from '../../src/application/services/life-summary-selection';
import type { CausalLifeEpisode, ICausalLifeRepository } from '../../src/application/ports/causal-life.interface';
import type { ISummaryCache, SummaryCache, SummaryPair, LifeSummaryRange } from '../../src/application/ports/summary';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const range: LifeSummaryRange = { mode: 'life_events', fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05' };
const game = (i: number): CausalLifeEpisode => ({ appRunId: 'app', sequence: i, revision: 1, occurredAt: `2026-11-0${1 + Math.floor((i-1) / 3)}T00:00:00.000Z`, activity: 'cursor_game', activityRunId: `run${i}`, outcome: 'completed', cause: 'completed', terminalReason: null, source: 'autonomy', participation: 'user_engaged', triggerSequence: null, executedMs: 1000 });
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse('2026-11-05T12:00:00.000Z'));
  let stored: SummaryCache = { formatVersion: 2, entry: null, receipt: null }, epoch = 0, generation = 0, events = Array.from({ length: 12 }, (_, i) => game(i+1));
  const write = vi.fn<ISummaryCache['write']>(async (value, expected) => { if (expected !== epoch) return { ok: false, code: 'stale' }; stored = value; return { ok: true, value: undefined }; });
  const cache: ISummaryCache = { read: async () => ({ ok: true, value: stored }), write, invalidate: () => ++epoch, clear: async reset => { epoch++; stored = { formatVersion: 2, entry: null, receipt: reset ? null : stored.receipt }; return { ok: true, value: undefined }; }, dispose: () => { epoch++; } };
  const resolveSources = vi.fn<ICausalLifeRepository['resolveSources']>(async refs => ({ ok: true, value: refs.flatMap(ref => { const found = events.find(e => e.appRunId === ref.appRunId && e.sequence === ref.sequence); return found ? [found] : []; }) }));
  const readWindow = vi.fn<ILifeHistoryReader['readWindow']>(async () => ({ ok: true as const, value: { coverage: 'complete' as const, events, examined: events.length, fetched: events.length } }));
  const generateSummary = vi.fn(async () => 'Recorded games were completed.');
  const pairs: SummaryPair[] = Array.from({ length: 18 }, (_, i) => ({ userMessageId: `u${i}`, assistantMessageId: `a${i}`, sessionId: 's', userText: 'Space', assistantText: 'Discussed space', eligible: true }));
  let id = 0;
  const options = { cache, generator: { generateSummary }, sources: { recent: async () => ({ ok: true as const, value: { pairs, facts: [] } }), exact: async (refs: readonly { userMessageId: string }[]) => ({ ok: true as const, value: { pairs: pairs.filter(p => refs.some(r => r.userMessageId === p.userMessageId)), facts: [] } }) }, lifeHistory: { readWindow }, causalLife: { append: vi.fn(), getRecent: vi.fn(), resolveSources }, context: () => ({ generation }), now: Date.now, createId: () => `id${++id}`, hash, scheduler: { setTimeout, clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) }, locale: 'en' as const, beforeRead: async () => {}, canGenerate: () => true };
  const runtime = new SummaryRuntime(options);
  return { runtime, options, cache, write, generateSummary, resolveSources, readWindow, stored: () => stored, change: (value: readonly CausalLifeEpisode[]) => { events = [...value]; }, events: () => events, mutate: () => { generation++; runtime.invalidate(); } };
}
async function preview(f: ReturnType<typeof fixture>) { const result = await f.runtime.preview(range); if (!result.ok || !('events' in result.value)) throw new Error('No life preview'); return result.value; }
afterEach(() => vi.useRealTimers());
it('selects latest4–8 known terminals and presents semantic UTC events without local identities', async () => {
  const f = fixture(), p = await preview(f); expect(p.events).toHaveLength(8); expect(p.events[0]?.occurredAt).toBe(game(5).occurredAt);
  expect(JSON.stringify(p)).not.toMatch(/appRunId|activityRunId|sequence|revision|contentDigest/u); expect(f.generateSummary).not.toHaveBeenCalled();
  const ignored = { ...game(13), cause: 'unknown' as const, source: 'unknown' as const, outcome: 'cancelled' as const };
  expect(selectLifeSummary([...f.events(), ignored])).toEqual(f.events().slice(-8));
  f.change(f.events().slice(0,3)); expect(await f.runtime.preview(range)).toEqual({ ok: false, code: 'unavailable' });
});
it('writes one durable receipt before explicit dispatch and freezes exact sources across later appends and restart', async () => {
  const f = fixture(), p = await preview(f); f.generateSummary.mockImplementation(async () => { expect(f.stored().receipt).toMatchObject({ mode: 'life_events', generatorVersion: 2 }); return 'Recorded games were completed.'; });
  const pending = f.runtime.confirm('command', p.previewId); expect(f.runtime.confirm('command', p.previewId)).toBe(pending); expect(await pending).toMatchObject({ ok: true });
  expect(f.generateSummary).toHaveBeenCalledOnce(); expect(f.stored().entry).toMatchObject({ mode: 'life_events', generatorVersion: 2 });
  f.change([...f.events(), ...Array.from({ length: 1000 }, (_, i) => ({ ...game(1), appRunId: 'later', sequence: i+1, activityRunId: `later${i}` }))]);
  const restarted = new SummaryRuntime(f.options); const capture = await restarted.capture('our games'); expect(capture?.life?.sources).toHaveLength(8); expect(capture?.life?.gameRuns).toHaveLength(8); expect(capture?.excludedMessageIds).toEqual([]);
  expect(await restarted.capture('unrelated space')).toBeUndefined(); expect(f.generateSummary).toHaveBeenCalledOnce();
});
it.each(['delete','correct'] as const)('rejects %s of a frozen source before generation, save and later chat capture', async kind => {
  const f = fixture(), p = await preview(f);
  const change = () => f.change(kind === 'delete' ? f.events().filter(e => e.sequence !== 5) : f.events().map(e => e.sequence === 5 ? { ...e, executedMs: 2000 } : e));
  change(); expect(await f.runtime.confirm('before', p.previewId)).toEqual({ ok: false, code: 'stale' }); expect(f.generateSummary).not.toHaveBeenCalled();
  f.change(Array.from({ length: 12 }, (_, i) => game(i+1))); const fresh = await preview(f); f.generateSummary.mockImplementation(async () => { change(); return 'Stale retelling'; });
  expect(await f.runtime.confirm('during', fresh.previewId)).toEqual({ ok: false, code: 'stale' }); expect(f.stored().entry).toBeNull(); expect(f.stored().receipt).not.toBeNull();
});
it.each(['dialogue_pairs','life_events'] as const)('shares one rolling24h receipt when first generation uses %s', async mode => {
  const f = fixture(), first = mode === 'life_events' ? await f.runtime.preview(range) : await f.runtime.preview(); if (!first.ok) throw new Error('No preview');
  expect((await f.runtime.confirm('first', first.value.previewId)).ok).toBe(true); await f.runtime.deleteSummary();
  const second = mode === 'life_events' ? await f.runtime.preview() : await f.runtime.preview(range); if (!second.ok) throw new Error('No preview');
  expect(await f.runtime.confirm('second', second.value.previewId)).toEqual({ ok: false, code: 'rate_limited' }); expect(f.generateSummary).toHaveBeenCalledOnce();
  vi.setSystemTime(1); expect(await f.runtime.confirm('second-again', second.value.previewId)).toEqual({ ok: false, code: 'rate_limited' });
});
it('expires preview at120s and never dispatches after failed receipt write', async () => {
  const f = fixture(), p = await preview(f); await vi.advanceTimersByTimeAsync(120000); expect(await f.runtime.confirm('expired', p.previewId)).toEqual({ ok: false, code: 'stale' });
  const fresh = await preview(f); f.write.mockResolvedValueOnce({ ok: false, code: 'io_error' }); expect(await f.runtime.confirm('failed-write', fresh.previewId)).toEqual({ ok: false, code: 'unavailable' }); expect(f.generateSummary).not.toHaveBeenCalled();
});
it('keeps a single unresolved proof slot after200ms without queuing more reads', async () => {
  const f = fixture(); let resolve = (_value: Awaited<ReturnType<ICausalLifeRepository['resolveSources']>>) => {};
  const p = await preview(f); expect((await f.runtime.confirm('initial', p.previewId)).ok).toBe(true);
  f.resolveSources.mockImplementationOnce(() => new Promise(yes => { resolve = yes; })); const pending = f.runtime.capture('our games'); await vi.advanceTimersByTimeAsync(200); expect(await pending).toBeUndefined();
  const calls = f.resolveSources.mock.calls.length; expect(await f.runtime.capture('our games')).toBeUndefined(); expect(f.resolveSources).toHaveBeenCalledTimes(calls);
  resolve({ ok: true, value: f.events().slice(-8) }); for (let i = 0; i < 10; i++) await Promise.resolve(); expect(await f.runtime.capture('our games')).toBeDefined();
});
it('a destructive mutation retires consumer proof and any late writer but does not erase the global receipt', async () => {
  const f = fixture(), p = await preview(f); let resolve = (_value: string) => {}; f.generateSummary.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  const pending = f.runtime.confirm('late', p.previewId); for (let i = 0; i < 30; i++) await Promise.resolve(); expect(f.generateSummary).toHaveBeenCalledOnce(); f.mutate(); resolve('Late summary');
  expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.stored().entry).toBeNull(); expect(f.stored().receipt).not.toBeNull();
});
it('rejects duplicate exact identities/runs and preserves private input order for same-time ties', () => {
  const values = Array.from({ length: 10 }, (_, i) => ({ ...game(i+1), occurredAt: '2026-11-05T00:00:00.000Z' }));
  expect(selectLifeSummary(values).map(e => e.sequence)).toEqual([3,4,5,6,7,8,9,10]);
  expect(selectLifeSummary([...values, values[0]!])).toEqual([]);
  expect(selectLifeSummary([...values, { ...values[0]!, sequence: 11 }])).toEqual([]);
  expect(selectLifeSummary([...values].reverse().map((e, i) => ({ ...e, occurredAt: game(10-i).occurredAt })))).toEqual([]);
});
it('revalidates saved sources on each capture and explicitly binds memory generation', async () => {
  const f = fixture(), p = await preview(f); expect((await f.runtime.confirm('saved', p.previewId)).ok).toBe(true);
  const capture = await f.runtime.capture('our games'); expect(capture).toBeDefined(); expect(f.runtime.isCurrent(capture!)).toBe(true);
  f.change(f.events().filter(e => e.sequence !== 5)); expect(await f.runtime.capture('our games')).toBeUndefined();
  f.mutate(); expect(f.runtime.isCurrent(capture!)).toBe(false);
});
it.each(['index_building','overflow','clock_unknown'] as const)('has no preview or inference for %s whole-window coverage', async coverage => {
  const f = fixture(); f.readWindow.mockResolvedValueOnce({ ok: true, value: { coverage, events: [], examined: 0, fetched: 0 } });
  expect(await f.runtime.preview(range)).toEqual({ ok: false, code: 'unavailable' }); expect(f.generateSummary).not.toHaveBeenCalled();
  expect(await f.runtime.preview({ ...range, fromDateUTC: '2026-02-30' })).toEqual({ ok: false, code: 'unavailable' });
});
it('persists a failed attempt across restart and rejects reusing that command for another source mode', async () => {
  const f = fixture(), p = await preview(f); f.generateSummary.mockRejectedValueOnce(new Error('offline'));
  expect(await f.runtime.confirm('same-command', p.previewId)).toEqual({ ok: false, code: 'failed' });
  const restarted = new SummaryRuntime(f.options), life = await restarted.preview(range); if (!life.ok) throw new Error('No preview');
  expect(await restarted.confirm('same-command', life.value.previewId)).toEqual({ ok: false, code: 'failed' });
  const pairs = await restarted.preview(); if (!pairs.ok) throw new Error('No pairs preview');
  expect(await restarted.confirm('same-command', pairs.value.previewId)).toEqual({ ok: false, code: 'conflict' }); expect(f.generateSummary).toHaveBeenCalledOnce();
});
it('does not start a late window read when a pending append settles after the shared200ms deadline', async () => {
  const f = fixture(); let pending = true, release = () => {}; const settled = new Promise<void>(resolve => { release = resolve; });
  const runtime = new SummaryRuntime({ ...f.options, sourceBarrier: { snapshot: () => ({ generation: 0, revision: 1, pending }), whenSettled: () => settled } });
  const preview = runtime.preview(range); await vi.advanceTimersByTimeAsync(200); expect(await preview).toEqual({ ok: false, code: 'unavailable' });
  pending = false; release(); for (let i = 0; i < 15; i++) await Promise.resolve(); expect(f.readWindow).not.toHaveBeenCalled();
});
it('leaves recognized current user facts on the ordinary unsuppressed dialogue path', async () => {
  const f = fixture(), p = await preview(f); expect((await f.runtime.confirm('facts', p.previewId)).ok).toBe(true);
  const before = f.resolveSources.mock.calls.length; expect(await f.runtime.capture('I like the cursor game')).toBeUndefined(); expect(f.resolveSources).toHaveBeenCalledTimes(before);
});
