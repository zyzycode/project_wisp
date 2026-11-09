import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoutineHypothesisRuntime } from '../../src/application/services/routine-hypothesis-runtime';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import type { RoutineEvidencePage } from '../../src/application/ports/world-context.interface';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let wallShift = 0, generation = 0;
  let source = { datasetEpoch: 'epoch', cohortId: 'cohort', zoneId: 'UTC', offsetMinutes: 0, revision: 1 };
  const counts = { windowStartHour: 6 as const, eligibleDays: 14, positiveDays: 14, recentPositiveDays: 7, observedThroughDate: '2026-11-08', qualifies: true };
  const repository = { readEvidence: vi.fn(async (): Promise<MemoryResult<RoutineEvidencePage>> => ({ ok: true, value: { counts, suppressed: false } })), setSuppressed: vi.fn() };
  const suppress = vi.fn(async (): Promise<MemoryResult<void>> => ({ ok: true, value: undefined }));
  const options = { repository, source: () => source, context: () => ({ generation }), whenSettled: vi.fn(async (): Promise<void> => undefined),
    now: Date.now, calendar: () => ({ utcMs: Date.parse('2026-11-09T07:00:00Z') + Date.now() - 100 + wallShift, localDate: '2026-11-09', zoneId: 'UTC', offsetMinutes: 0, windowStartHour: 6 as const }),
    scheduler: { setTimeout: (fn: () => void, delay: number) => setTimeout(fn, delay), clearTimeout: (timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>) }, suppress };
  const runtime = new RoutineHypothesisRuntime(options);
  return { runtime, repository, options, suppress, counts, shift: (delta: number) => { wallShift += delta; }, mutate: () => { source = { ...source, revision: source.revision + 1 }; }, resetGeneration: () => generation++ };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100); });
afterEach(() => vi.useRealTimers());
it('defaults sharing off; preview is local and repeated reads never increase evidence', async () => {
  const f = fixture(); expect(await f.runtime.prepare(300)).toBeUndefined(); expect(f.repository.readEvidence).not.toHaveBeenCalled();
  const a = await f.runtime.preview(), b = await f.runtime.preview(); expect(a).toEqual(b); expect(a.sharing).toBe(false);
  f.runtime.setSharing(true); const capture = await f.runtime.prepare(300); expect(capture?.context).toEqual({ scope: 'while_wisp_running', validity: 'tentative', ...Object.fromEntries(Object.entries(f.counts).filter(([key]) => key !== 'qualifies')) });
  expect(capture && f.runtime.isCurrent(capture)).toBe(true);
});
it.each(['withdraw', 'source', 'generation', 'dispose', 'reset'] as const)('invalidates an already prepared projection on %s', async why => {
  const f = fixture(); f.runtime.setSharing(true); const capture = (await f.runtime.prepare(300))!;
  if (why === 'withdraw') f.runtime.setSharing(false); else if (why === 'source') f.mutate(); else if (why === 'generation') f.resetGeneration(); else if (why === 'dispose') f.runtime.dispose(); else f.runtime.reset();
  expect(f.runtime.isCurrent(capture)).toBe(false);
});
it('omits late reads after source mutation without publishing a partially validated hypothesis', async () => {
  const f = fixture(), waiting = deferred<MemoryResult<RoutineEvidencePage>>(); f.runtime.setSharing(true); f.repository.readEvidence.mockReturnValueOnce(waiting.promise);
  const pending = f.runtime.prepare(300); await Promise.resolve(); f.mutate(); waiting.resolve({ ok: true, value: { counts: f.counts, suppressed: false } }); expect(await pending).toBeUndefined();
});
it('rejects wall/monotonic discontinuity before reusing the same source', async () => {
  const f = fixture(); f.runtime.setSharing(true); const capture = (await f.runtime.prepare(300))!; f.shift(5000); expect(f.runtime.isCurrent(capture)).toBe(false);
});
it('never lets a pre-reset suppression acknowledgement undo a newer withdrawal', async () => {
  const f = fixture(), waiting = deferred<MemoryResult<void>>(); f.suppress.mockReturnValueOnce(waiting.promise);
  const old = f.runtime.setSuppressed(6, false); f.runtime.reset(); await f.runtime.setSuppressed(6, true);
  waiting.resolve({ ok: true, value: undefined }); await old; expect((await f.runtime.preview()).suppressed).toBe(true);
});
it('keeps safe RAM suppression after lost acknowledgement and does not retry automatically', async () => {
  const f = fixture(); f.suppress.mockResolvedValueOnce({ ok: false, code: 'unavailable' }); expect(await f.runtime.setSuppressed(6, true)).toEqual({ ok: false, code: 'unavailable' });
  f.runtime.setSharing(true); expect(await f.runtime.prepare(300)).toBeUndefined(); expect(f.suppress).toHaveBeenCalledOnce();
  expect((await f.runtime.preview()).suppressed).toBe(true); await f.runtime.setSuppressed(6, false); expect((await f.runtime.preview()).suppressed).toBe(false);
});
it('bounds the whole settle/read group to 200ms and never queues another unsettled group', async () => {
  const f = fixture(), waiting = deferred<void>(); f.runtime.setSharing(true); f.options.whenSettled.mockReturnValueOnce(waiting.promise);
  const pending = f.runtime.prepare(5000); await vi.advanceTimersByTimeAsync(201); expect(await Promise.race([pending, Promise.resolve('pending')])).toBeUndefined();
  expect(await f.runtime.prepare(5000)).toBeUndefined(); expect(f.repository.readEvidence).not.toHaveBeenCalled(); waiting.resolve(); await Promise.resolve(); await Promise.resolve();
});
