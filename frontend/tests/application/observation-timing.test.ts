import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observationFixture, flush } from './observation-fixture';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());
it('requires both consents and uses only already authorized samples without starting helper or inference', () => {
  const f = observationFixture(); const calls = f.observer.replacePolicy.mock.calls.length;
  f.runtime.setTimingEnabled(true); f.sample();
  expect(f.observer.replacePolicy).toHaveBeenCalledTimes(calls); expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  f.runtime.enable(); f.sample(); expect(f.runtime.getComputerContext().foreground).toBe('settling');
  expect(f.generateObservation).not.toHaveBeenCalled(); expect(f.spendBudget).not.toHaveBeenCalled();
  const noBackend = observationFixture(false); noBackend.runtime.enable(); noBackend.runtime.setTimingEnabled(true); noBackend.sample();
  expect(noBackend.runtime.getComputerContext().foreground).toBe('unknown'); expect(noBackend.policy().active).toBe(false);
});
it('ignores title/source-token changes for3s settling and keeps transport-busy separate from availability', () => {
  const f = observationFixture(); f.runtime.enable(); f.runtime.setTimingEnabled(true); f.sample();
  const generation = f.runtime.getComputerContext().generation;
  f.canStartObservation.mockReturnValue(false);
  for (let i = 1; i <= 3; i++) { vi.advanceTimersByTime(1000); f.sample(`title-${i}`, 'episode', { windowTitle: `Title ${i}` }); }
  expect(f.runtime.getComputerContext('active')).toMatchObject({ generation, foreground: 'stable', presence: 'active' });
  f.runtime.invalidate(); expect(f.runtime.getComputerContext().foreground).toBe('stable');
  expect(JSON.stringify(f.runtime.getComputerContext())).not.toMatch(/opaque|Title|appKey|episodeToken|sourceToken/u);
});
it.each(['disable', 'pause', 'clear', 'reset', 'dispose', 'backendUnavailable'] as const)('clears timing consent and context on%s', method => {
  const f = observationFixture(); f.runtime.enable(); f.runtime.setTimingEnabled(true); f.sample();
  const generation = f.runtime.getComputerContext().generation; f.runtime[method]();
  expect(f.runtime.getSettings()).toMatchObject({ timingEnabled: false, timingStatus: 'off' });
  expect(f.runtime.getComputerContext()).toMatchObject({ foreground: 'unknown' });
  expect(f.runtime.getComputerContext().generation).toBeGreaterThan(generation);
});
it('policy/exclusion, unavailable, out-of-order and stale streams cannot preserve source knowledge', () => {
  const f = observationFixture(); f.runtime.enable(); f.runtime.setTimingEnabled(true); f.sample();
  f.runtime.exclude('app', true); f.sample(); expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  f.runtime.exclude('app', false); f.sample(); expect(f.runtime.getComputerContext().foreground).toBe('settling');
  f.unavailable('excluded'); expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  f.sample(); const generation = f.runtime.getComputerContext().generation;
  f.sample('source', 'episode', { revision: 0 }); expect(f.runtime.getComputerContext()).toMatchObject({ foreground: 'unknown', generation: generation + 1 });
  vi.advanceTimersByTime(1000); f.sample(); vi.advanceTimersByTime(2501);
  expect(f.runtime.getSettings().timingStatus).toBe('unavailable');
});
it('an observed non-aborted backend failure invalidates context without adding calls or changing the attempt guard', async () => {
  const f = observationFixture(); f.runtime.enable(); f.runtime.setTimingEnabled(true); f.generateObservation.mockRejectedValueOnce(new Error('offline'));
  await f.dwell(); expect(f.generateObservation).toHaveBeenCalledOnce();
  expect(f.runtime.getComputerContext().foreground).toBe('unknown'); expect(f.runtime.getSettings().timingStatus).toBe('unavailable');
  vi.advanceTimersByTime(1000); f.sample('next', 'next'); expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  f.runtime.setTimingEnabled(false); f.runtime.setTimingEnabled(true); vi.advanceTimersByTime(1000); f.sample(); await flush();
  expect(f.runtime.getComputerContext().foreground).toBe('settling'); expect(f.generateObservation).toHaveBeenCalledOnce();
});
it('cached backend loss immediately removes context and explicit unavailable callback stops the authorized helper', () => {
  let available = true;
  const f = observationFixture(true, Date.now, () => available); f.runtime.enable(); f.runtime.setTimingEnabled(true); f.sample();
  const generation = f.runtime.getComputerContext().generation; available = false;
  expect(f.runtime.getComputerContext()).toMatchObject({ foreground: 'unknown', generation: generation + 1 });
  f.runtime.backendUnavailable(); expect(f.policy().active).toBe(false); expect(f.runtime.getSettings().timingEnabled).toBe(false);
  f.runtime.resume(); f.runtime.setTimingEnabled(true); f.sample(); expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  expect(f.generateObservation).not.toHaveBeenCalled();
});
it('cannot adopt a pre-opt-in or pre-unavailable sample whose revision is older than the authorized stream', () => {
  const f = observationFixture(); f.runtime.enable(); f.sample();
  f.runtime.setTimingEnabled(true); vi.advanceTimersByTime(1000); f.sample('source', 'episode', { revision: 1 });
  expect(f.runtime.getComputerContext().foreground).toBe('unknown');
  vi.advanceTimersByTime(1000); f.sample(); expect(f.runtime.getComputerContext().foreground).toBe('settling');
  f.unavailable('excluded'); f.runtime.setTimingEnabled(false); f.runtime.setTimingEnabled(true);
  vi.advanceTimersByTime(1000); f.sample('source', 'episode', { revision: 3 });
  expect(f.runtime.getComputerContext().foreground).toBe('unknown');
});
