import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalSpeechSynthesizer } from '../../src/infrastructure/voice-output/local-speech-synthesizer';
const harness = vi.hoisted(() => ({ workers: [] as EventEmitter[], post: vi.fn(), terminate: vi.fn(async () => 0), verified: vi.fn(async () => true) }));
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter { constructor() { super(); harness.workers.push(this); } postMessage(value: unknown) { harness.post(value); } terminate() { return harness.terminate(); } } }));
vi.mock('../../src/infrastructure/voice/model-cache', () => ({ verifiedFile: harness.verified }));
afterEach(() => { vi.useRealTimers(); harness.workers.length = 0; harness.post.mockClear(); harness.terminate.mockReset().mockResolvedValue(0); harness.verified.mockResolvedValue(true); });
it('verifies resources offline and never creates a worker with an absent model', async () => {
  const adapter = new LocalSpeechSynthesizer('/resources', '/worker'); harness.verified.mockResolvedValue(false);
  expect(await adapter.ready()).toBe(false); expect(harness.workers).toHaveLength(0); await adapter.dispose();
});
it('reuses the worker, rejects foreign results and terminates on cancellation', async () => {
  const adapter = new LocalSpeechSynthesizer('/resources', '/worker');
  const first = adapter.synthesize('Привет!', 'ru', new AbortController().signal); await Promise.resolve();
  harness.workers[0]?.emit('message', { id: 999, ok: true, samples: new Float32Array([0.1]) });
  harness.workers[0]?.emit('message', { id: 1, ok: true, samples: new Float32Array([0.1]) });
  expect(await first).toEqual({ sampleRate: 24000, samples: new Float32Array([0.1]) });
  const abort = new AbortController(); const second = adapter.synthesize('Ещё!', 'ru', abort.signal); await Promise.resolve();
  const rejected = expect(second).rejects.toThrow(); abort.abort(); await rejected;
  expect(harness.workers).toHaveLength(1); expect(harness.terminate).toHaveBeenCalledOnce(); await adapter.dispose();
});
it.each(['malformed', 'timeout'] as const)('bounds %s work and retires the worker', async reason => {
  vi.useFakeTimers(); const adapter = new LocalSpeechSynthesizer('/resources', '/worker');
  const pending = adapter.synthesize('Hello!', 'en', new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow(); await Promise.resolve();
  if (reason === 'malformed') harness.workers[0]?.emit('message', { id: 1, ok: true, samples: new Float32Array([NaN]) });
  else await vi.advanceTimersByTimeAsync(120000);
  await rejected; expect(harness.terminate).toHaveBeenCalledOnce(); await adapter.dispose();
});
