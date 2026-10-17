import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { observationFixture, flush } from './observation-fixture';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());
it('starts off, keeps only safe RAM policy, previews only explicitly, resets consent in a new run', () => {
  const f = observationFixture(); expect(f.runtime.getSettings()).toMatchObject({ enabled: false, preview: null, status: 'off' });
  f.runtime.enable(); f.sample(); expect(f.runtime.getSettings().preview).toBeNull(); f.runtime.preview(true);
  expect(f.runtime.getSettings().preview).toEqual({ appName: 'Code', windowTitle: 'Synthetic title' }); f.runtime.preview(false); expect(f.runtime.getSettings().preview).toBeNull();
  f.runtime.clear(); expect(f.runtime.getSettings()).toMatchObject({ enabled: false, applications: [], preview: null });
  expect(observationFixture().runtime.getSettings().enabled).toBe(false);
});
it('requires 30s continuous samples, spends budget exactly once and never includes aliases/local metadata', async () => {
  const f = observationFixture(); f.runtime.enable(); await f.dwell('s', 'e', 29); expect(f.generateObservation).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000); f.sample('s', 'e'); await flush();
  expect(f.spendBudget).toHaveBeenCalledTimes(1); expect(f.generateObservation).toHaveBeenCalledTimes(1);
  expect(f.generateObservation.mock.calls[0]?.[0].observation).toEqual({ appName: 'Code', windowTitle: 'Synthetic title' });
  expect(f.runtime.getSpeech()?.text).toBe('Может, сделать паузу?'); await vi.advanceTimersByTimeAsync(2000); expect(f.runtime.getSpeech()).toBeNull();
});
it.each(['allowed', 'busy', 'higherSpeech', 'budget', 'thinking'] as const)('drops the threshold opportunity blocked by %s without deferred retry', async blocked => {
  const f = observationFixture(); f.runtime.enable(); if (blocked === 'allowed') f.gate.allowed = false; if (blocked === 'busy') f.gate.busy = true; if (blocked === 'higherSpeech') f.gate.higherSpeech = true;
  if (blocked === 'budget') f.spendBudget.mockReturnValue(false); if (blocked === 'thinking') f.runtime.observeDialogue({ conversationId: 'c', canSubmit: false, turn: { phase: 'thinking', requestId: 'r' } });
  await f.dwell(); expect(f.generateObservation).not.toHaveBeenCalled(); f.gate.allowed = true; f.gate.busy = false; f.gate.higherSpeech = false; f.spendBudget.mockReturnValue(true);
  f.runtime.observeDialogue({ conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } }); await f.dwell(); expect(f.generateObservation).not.toHaveBeenCalled();
});
it('resets dwell at >1500ms sample gaps and title token changes even with identical public metadata', async () => {
  const f = observationFixture(); f.runtime.enable(); await f.dwell('s', 'e', 29); await vi.advanceTimersByTimeAsync(1501); f.sample('s', 'e'); expect(f.generateObservation).not.toHaveBeenCalled();
  await f.dwell('different-full-title-token', 'e', 29); expect(f.generateObservation).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1000); f.sample('different-full-title-token', 'e'); await flush(); expect(f.generateObservation).toHaveBeenCalledTimes(1);
});
it.each(['pause', 'disable', 'clear', 'reset', 'dispose', 'policy', 'source', 'episode', 'identity', 'higherSpeech', 'stale', 'generation', 'expired'] as const)('discards in-flight output after %s', async change => {
  const f = observationFixture(); let resolve!: (value: string) => void;
  f.generateObservation.mockImplementation(() => new Promise(yes => { resolve = yes; })); f.runtime.enable(); await f.dwell();
  if (['pause', 'disable', 'clear', 'reset', 'dispose'].includes(change)) { if (change === 'pause') f.runtime.pause(); if (change === 'disable') f.runtime.disable(); if (change === 'clear') f.runtime.clear(); if (change === 'reset') f.runtime.reset(); if (change === 'dispose') f.runtime.dispose(); }
  if (change === 'policy') f.runtime.exclude('app', true); if (change === 'source') f.sample('next'); if (change === 'episode') f.sample('source', 'next'); if (change === 'identity') f.gate.identity = 'other';
  if (change === 'higherSpeech') f.gate.higherSpeech = true; if (change === 'stale') vi.setSystemTime(Date.now() + 2501); if (change === 'expired') { vi.setSystemTime(Date.now() + 3500); f.sample(); }
  if (change === 'generation') { f.runtime.pause(); f.runtime.resume(); f.sample(); }
  resolve('Late title reply'); await flush(); expect(f.runtime.getSpeech()).toBeNull();
});
it('fresh revisions confirm source without extending absolute request deadline', async () => {
  const f = observationFixture(); let resolve!: (value: string) => void; f.generateObservation.mockImplementation(() => new Promise(yes => { resolve = yes; })); f.runtime.enable(); await f.dwell();
  for (let i = 0; i < 3; i++) { await vi.advanceTimersByTimeAsync(1000); f.sample(); } await vi.advanceTimersByTimeAsync(500); resolve('too late'); await flush(); expect(f.runtime.getSpeech()).toBeNull();
});
it('retains 10min attempt guard after failures, pause/resume and policy changes; same episode never retries', async () => {
  const f = observationFixture(); f.generateObservation.mockRejectedValue(new Error('offline')); f.runtime.enable(); await f.dwell(); expect(f.generateObservation).toHaveBeenCalledTimes(1);
  f.runtime.pause(); f.runtime.resume(); await f.dwell('new', 'new'); expect(f.generateObservation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600000); await f.dwell('other', 'episode'); expect(f.generateObservation).toHaveBeenCalledTimes(1);
  await f.dwell('last', 'last'); expect(f.generateObservation).toHaveBeenCalledTimes(2); expect(f.runtime.getSpeech()).toBeNull();
});
it.each(['paused', 'bridge_failed'] as const)('requires explicit resume after %s, never automatically starts helper', reason => {
  const f = observationFixture(); f.runtime.enable(); f.unavailable(reason); expect(f.runtime.getSettings().paused).toBe(true); expect(f.policy().active).toBe(false); f.runtime.resume(); expect(f.policy().active).toBe(true);
});
it('waits for transport settlement on user preemption and hides current speech immediately', async () => {
  const f = observationFixture(); let resolve!: (value: string) => void; f.generateObservation.mockImplementation(() => new Promise(yes => { resolve = yes; })); f.runtime.enable(); await f.dwell();
  const settled = vi.fn(); const waiting = f.runtime.interruptForUser().then(settled); await flush(); expect(settled).not.toHaveBeenCalled(); expect(f.generateObservation.mock.calls[0]?.[1].aborted).toBe(true);
  resolve('late'); await waiting; expect(f.runtime.getSpeech()).toBeNull();
});
it('guards observation for 5s after terminal dialogue and never queues the missed opportunity', async () => {
  const f = observationFixture(); f.runtime.enable(); await f.dwell('s', 'e', 29);
  f.runtime.observeDialogue({ conversationId: 'c', canSubmit: true, turn: { phase: 'completed', requestId: 'r', replyText: 'reply', outcome: { kind: 'success' } } });
  await vi.advanceTimersByTimeAsync(1000); f.sample('s', 'e'); await flush(); expect(f.generateObservation).not.toHaveBeenCalled(); await f.dwell('s', 'e'); expect(f.generateObservation).not.toHaveBeenCalled();
});
it('mock/direct-only mode is unavailable and never starts helper or promises AI preview', () => {
  const f = observationFixture(false); f.runtime.enable(); f.sample(); f.runtime.preview(true);
  expect(f.runtime.getSettings()).toMatchObject({ status: 'unavailable', reason: 'backend_unavailable', preview: null });
  expect(f.policy().active).toBe(false); expect(f.generateObservation).not.toHaveBeenCalled();
});
it('a draining shared transport loses the threshold opportunity without spending budget', async () => {
  const f = observationFixture(); f.canStartObservation.mockReturnValue(false); f.runtime.enable(); await f.dwell();
  expect(f.spendBudget).not.toHaveBeenCalled(); expect(f.generateObservation).not.toHaveBeenCalled(); f.canStartObservation.mockReturnValue(true); await f.dwell(); expect(f.generateObservation).not.toHaveBeenCalled();
});
