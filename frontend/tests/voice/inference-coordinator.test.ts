import { afterEach, expect, it, vi } from 'vitest';
import { VoiceInferenceCoordinator, voiceCpuBudget, voiceSessionOptions } from '../../src/infrastructure/voice/inference-coordinator';
afterEach(() => vi.useRealTimers());
it.each([[1,1,1],[2,1,1],[4,2,3],[8,2,7],[16,2,8]])('bounds CPU capacity %i without exhausting a small machine', (n, stt, tts) => {
  expect(voiceCpuBudget(n)).toEqual({ sttThreads: stt, ttsThreads: tts });
});
it.each([0,9,NaN,1.5])('rejects invalid native thread count %s', threads => {
  expect(() => voiceSessionOptions(threads)).toThrow();
});
it('keeps only one bounded waiter and makes release idempotent', async () => {
  const gate = new VoiceInferenceCoordinator(), signal = new AbortController().signal;
  const release = gate.tryAcquire()!;
  const pending = gate.acquire(signal, performance.now() + 1000);
  await expect(gate.acquire(signal, performance.now() + 1000)).rejects.toThrow();
  release(); const next = await pending; release(); expect(gate.tryAcquire()).toBeNull(); next();
  expect(gate.tryAcquire()).toBeTypeOf('function');
});
it('dispose/cancel removes a waiter while an unreaped owner still holds admission', async () => {
  const gate = new VoiceInferenceCoordinator(), abort = new AbortController();
  const release = gate.tryAcquire()!;
  const pending = gate.acquire(abort.signal, performance.now() + 1000); const rejected = expect(pending).rejects.toThrow();
  abort.abort(); await rejected;
  expect(gate.tryAcquire()).toBeNull(); release(); expect(gate.tryAcquire()).toBeTypeOf('function');
});
