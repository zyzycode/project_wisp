import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalVoiceInput } from '../../src/infrastructure/voice/voice-input-adapter';
const harness = vi.hoisted(() => ({ workers: [] as EventEmitter[], postMessage: vi.fn(), terminate: vi.fn<() => Promise<number>>(), verify: vi.fn(async () => true) }));
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter { constructor() { super(); harness.workers.push(this); } postMessage(value: unknown) { harness.postMessage(value); } terminate() { return harness.terminate().then(code => { this.emit('exit', code); return code; }); } } }));
vi.mock('../../src/infrastructure/voice/model-cache', () => ({ VoiceModelCache: class { directory = '/verified'; verify = harness.verify; } }));
afterEach(() => { vi.useRealTimers(); harness.workers.length = 0; harness.verify.mockResolvedValue(true); harness.postMessage.mockClear(); harness.terminate.mockReset().mockResolvedValue(0); });
it('returns cancel promptly while native termination is pending, remains busy', async () => {
  vi.useFakeTimers();
  harness.terminate.mockImplementation(() => new Promise(() => undefined));
  const adapter = new LocalVoiceInput('/cache', '/worker'); const abort = new AbortController();
  const audio = { samples: new Float32Array([0.1]), sampleRate: 16000 as const, language: 'en' as const };
  const pending = adapter.transcribe(audio, abort.signal); await Promise.resolve(); abort.abort();
  expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  expect(await adapter.transcribe(audio, new AbortController().signal)).toEqual({ ok: false, code: 'busy' });
  harness.workers[0]?.emit('message', { requestId: 1, ok: true, value: 'Late' });
});
it('returns timeout even when worker termination rejects without unhandled rejection', async () => {
  vi.useFakeTimers(); harness.terminate.mockRejectedValue(new Error('native teardown'));
  const adapter = new LocalVoiceInput('/cache', '/worker');
  const pending = adapter.transcribe({ samples: new Float32Array([0.1]), sampleRate: 16000, language: 'en' }, new AbortController().signal);
  await Promise.resolve(); await vi.advanceTimersByTimeAsync(60000);
  expect(await pending).toEqual({ ok: false, code: 'timeout' });
});
it('rejects corrupt cache before worker startup', async () => {
  harness.verify.mockResolvedValue(false); const adapter = new LocalVoiceInput('/cache', '/worker');
  expect(await adapter.transcribe({ samples: new Float32Array([0.1]), sampleRate: 16000, language: 'ru' }, new AbortController().signal)).toEqual({ ok: false, code: 'integrity_failed' });
  expect(harness.workers).toHaveLength(0);
});

it('disables native telemetry before worker can initialize ORT', () => {
  vi.stubEnv('ORT_DISABLE_TELEMETRY', '0');
  new LocalVoiceInput('/cache', '/worker');
  expect(process.env.ORT_DISABLE_TELEMETRY).toBe('1');
  vi.unstubAllEnvs();
});

it('initializes a bundled model offline without downloading at runtime', async () => {
  const fetcher = vi.fn(() => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetcher);
  const adapter = new LocalVoiceInput('/cache', '/worker', '/resources');
  await adapter.initialize();
  expect(adapter.getStatus().state).toBe('ready');
  expect(await adapter.prepare(new AbortController().signal)).toEqual({ ok: true, value: undefined });
  expect(fetcher).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
it('keeps the recognizer worker alive across sequential utterances', async () => {
  harness.terminate.mockResolvedValue(0);
  const adapter = new LocalVoiceInput('/cache', '/worker');
  const audio = { samples: new Float32Array([0.2]), sampleRate: 16000 as const, language: 'ru' as const };
  const first = adapter.transcribe(audio, new AbortController().signal); await Promise.resolve();
  harness.workers[0]?.emit('message', { requestId: 1, ok: true, value: 'Первая' });
  expect(await first).toEqual({ ok: true, value: 'Первая' });
  const second = adapter.transcribe(audio, new AbortController().signal); await Promise.resolve();
  expect(harness.workers).toHaveLength(1);
  harness.workers[0]?.emit('message', { requestId: 2, ok: true, value: 'Вторая' });
  expect(await second).toEqual({ ok: true, value: 'Вторая' });
  expect(harness.postMessage).toHaveBeenCalledTimes(2);
  await adapter.dispose();
});

it('ignores a previous utterance reply while the next one is active', async () => {
  const adapter = new LocalVoiceInput('/cache', '/worker');
  const audio = { samples: new Float32Array([0.2]), sampleRate: 16000 as const, language: 'en' as const };
  const first = adapter.transcribe(audio, new AbortController().signal); await Promise.resolve();
  harness.workers[0]?.emit('message', { requestId: 1, ok: true, value: 'First' }); await first;
  const second = adapter.transcribe(audio, new AbortController().signal); await Promise.resolve();
  harness.workers[0]?.emit('message', { requestId: 1, ok: true, value: 'Duplicate' });
  harness.workers[0]?.emit('message', { requestId: 2, ok: true, value: 'Second' });
  expect(await second).toEqual({ ok: true, value: 'Second' }); await adapter.dispose();
});
it('recreates a terminated worker after cancellation without accepting its late reply', async () => {
  harness.terminate.mockResolvedValue(0);
  const adapter = new LocalVoiceInput('/cache', '/worker'); const abort = new AbortController();
  const audio = { samples: new Float32Array([0.2]), sampleRate: 16000 as const, language: 'en' as const };
  const first = adapter.transcribe(audio, abort.signal); await Promise.resolve(); abort.abort();
  expect(await first).toEqual({ ok: false, code: 'cancelled' });
  harness.workers[0]?.emit('exit', 0);
  await Promise.resolve(); await Promise.resolve();
  const second = adapter.transcribe(audio, new AbortController().signal); await Promise.resolve();
  expect(harness.workers).toHaveLength(2);
  harness.workers[0]?.emit('message', { requestId: 1, ok: true, value: 'Late' });
  harness.workers[1]?.emit('message', { requestId: 2, ok: true, value: 'Current' });
  expect(await second).toEqual({ ok: true, value: 'Current' }); await adapter.dispose();
});
