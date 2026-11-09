import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ScreenObservationEvidence } from '../../src/application/ports/backend-screen-observation-contract';
import { ScreenObservationRuntime } from '../../src/application/services/screen-observation-runtime';
import type { ScreenCaptureAuthorization, PreparedScreenObservation } from '../../src/application/ports/screen-observation.interface';
const identity = { streamId: 's', conversationId: 'c' }, region = { left: .1, top: .2, width: .4, height: .3 };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function setup() {
  let current: typeof identity | null = identity;
  const provider = { reserve: vi.fn(() => true), release: vi.fn(), getCapability: vi.fn(async () => ({ status: 'available', provider: 'openai', model: 'gpt-6-astra', policyRevision: 'screen-openai-2026-11' } as const)), observe: vi.fn(async (): Promise<ScreenObservationEvidence> => ({ visible: ['Rectangle'], possible: [], unknown: [] })) };
  const capture = { availability: vi.fn(() => ({ status: 'available' } as const)), dispose: vi.fn(), capture: vi.fn(async (auth: ScreenCaptureAuthorization): Promise<PreparedScreenObservation> => ({ context: auth.context, previewId: 'p', digest: 'digest', preparedAtMs: Date.now(), expiresAtMs: Date.now() + 30000, image: { mimeType: 'image/jpeg', width: 64, height: 64, dataBase64: '/9j/2Q==' } })) };
  const options = { provider, capture, now: Date.now, createId: () => '00000000-0000-4000-8000-000000000001', current: () => current, busy: vi.fn(() => false), schedule: (delay: number, fn: () => void) => { const timer = setTimeout(fn, delay); return () => clearTimeout(timer); }, select: vi.fn(async () => undefined), closeSelector: vi.fn(), confirmCapture: vi.fn(async () => true), confirmSend: vi.fn(async () => true), hidden: async <T>(work: () => Promise<T>): Promise<T> => work() };
  const runtime = new ScreenObservationRuntime(options);
  return { runtime, options, provider, capture, replace: () => { current = { ...identity, conversationId: 'next' }; } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100); });
afterEach(() => vi.useRealTimers());
it('uses separate full-frame and send consents, exposes only crop, publishes temporary evidence and releases references', async () => {
  const f = setup(); await f.runtime.start(identity); expect(f.capture.capture).not.toHaveBeenCalled();
  await f.runtime.region(region); expect(f.options.confirmCapture).toHaveBeenCalledOnce(); expect(f.provider.observe).not.toHaveBeenCalled(); expect(f.runtime.read().preview).toMatchObject({ width: 64, dataBase64: '/9j/2Q==' });
  await f.runtime.send(); expect(f.options.confirmSend).toHaveBeenCalledOnce(); expect(f.provider.observe).toHaveBeenCalledOnce(); expect(f.runtime.read()).toMatchObject({ phase: 'visible', preview: null, evidence: { visible: ['Rectangle'] } });
  await vi.advanceTimersByTimeAsync(60000); expect(f.runtime.read()).toMatchObject({ phase: 'idle', preview: null, evidence: null });
  f.runtime.dispose(); expect(vi.getTimerCount()).toBe(0); expect(f.capture.dispose).toHaveBeenCalledOnce();
});
it.each(['capture', 'send'] as const)('cancelled %s confirmation never invokes the corresponding operation', async phase => {
  const f = setup(); await f.runtime.start(identity);
  if (phase === 'capture') f.options.confirmCapture.mockResolvedValue(false);
  else f.options.confirmSend.mockResolvedValue(false);
  await f.runtime.region(region); if (phase === 'send') await f.runtime.send();
  expect(f.provider.observe).not.toHaveBeenCalled(); if (phase === 'capture') expect(f.capture.capture).not.toHaveBeenCalled();
  expect(f.runtime.read().phase).toBe('idle');
});
it.each(['capture', 'send'] as const)('late native %s confirmation after timeout/reset cannot restart capture or send', async phase => {
  const f = setup(), waiting = deferred<boolean>(); await f.runtime.start(identity);
  if (phase === 'capture') f.options.confirmCapture.mockReturnValue(waiting.promise); else f.options.confirmSend.mockReturnValue(waiting.promise);
  const work = phase === 'capture' ? f.runtime.region(region) : f.runtime.region(region).then(() => f.runtime.send());
  await Promise.resolve(); await Promise.resolve(); await vi.advanceTimersByTimeAsync(30001);
  waiting.resolve(true); await work;
  expect(f.provider.observe).not.toHaveBeenCalled(); if (phase === 'capture') expect(f.capture.capture).not.toHaveBeenCalled();
  expect(f.runtime.read().preview).toBeNull();
});
it.each(['cancel', 'reset', 'dispose'] as const)('late getSources completion after %s cannot publish preview or call provider', async reason => {
  const f = setup(), waiting = deferred<PreparedScreenObservation>(); await f.runtime.start(identity);
  let captured: PreparedScreenObservation | undefined;
  const original = f.capture.capture.getMockImplementation()!;
  f.capture.capture.mockImplementation(async auth => { captured = await original(auth); return waiting.promise; });
  const work = f.runtime.region(region); await Promise.resolve(); await Promise.resolve();
  if (reason === 'dispose') f.runtime.dispose(); else if (reason === 'reset') { f.replace(); f.runtime.read(); } else f.runtime.cancel();
  waiting.resolve(captured!); await work;
  expect(f.runtime.read()).toMatchObject({ phase: 'idle', preview: null, evidence: null }); expect(f.provider.observe).not.toHaveBeenCalled();
});
it('keeps capture rate guard across cancellation/reset; duplicate send dispatches only once', async () => {
  const f = setup(); await f.runtime.start(identity); await f.runtime.region(region);
  const waiting = deferred<{ visible: string[]; possible: string[]; unknown: string[] }>(); f.provider.observe.mockReturnValue(waiting.promise);
  const first = f.runtime.send(); await Promise.resolve(); await Promise.resolve();
  await f.runtime.send(); waiting.resolve({ visible: ['late'], possible: [], unknown: [] }); await first;
  expect(f.provider.observe).toHaveBeenCalledOnce(); expect(f.runtime.read().evidence).toEqual({ visible: ['late'], possible: [], unknown: [] });
  expect(await f.runtime.start(identity)).toMatchObject({ error: 'busy' });
});
it('honors unavailable capability/busy before capture and never downloads/probes inference', async () => {
  const f = setup(); f.options.busy.mockReturnValue(true); expect(await f.runtime.start(identity)).toMatchObject({ error: 'busy' }); expect(f.provider.getCapability).not.toHaveBeenCalled();
  f.options.busy.mockReturnValue(false); f.provider.getCapability.mockRejectedValue(new Error('private detail')); await f.runtime.start(identity);
  expect(f.runtime.read()).toMatchObject({ phase: 'idle', error: 'unavailable' }); expect(f.capture.capture).not.toHaveBeenCalled(); expect(f.provider.observe).not.toHaveBeenCalled();
});
it('a retired send confirmation cannot cancel a newer selection', async () => {
  const f = setup(), waiting = deferred<boolean>(); await f.runtime.start(identity); await f.runtime.region(region);
  f.options.confirmSend.mockReturnValueOnce(waiting.promise); const old = f.runtime.send();
  await vi.advanceTimersByTimeAsync(30001); await f.runtime.start(identity); expect(f.runtime.read().phase).toBe('selecting');
  waiting.resolve(true); await old; expect(f.runtime.read().phase).toBe('selecting'); expect(f.provider.observe).not.toHaveBeenCalled();
});
