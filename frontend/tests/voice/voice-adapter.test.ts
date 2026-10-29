import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalVoiceInput } from '../../src/infrastructure/voice/voice-input-adapter';
const harness = vi.hoisted(() => ({ workers: [] as EventEmitter[], terminate: vi.fn<() => Promise<number>>(), verify: vi.fn(async () => true) }));
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter { constructor() { super(); harness.workers.push(this); } terminate() { return harness.terminate(); } } }));
vi.mock('../../src/infrastructure/voice/model-cache', () => ({ VoiceCacheError: class extends Error {}, VoiceModelCache: class { directory = '/verified'; verify = harness.verify; } }));
afterEach(() => { vi.useRealTimers(); harness.workers.length = 0; harness.verify.mockResolvedValue(true); });
it('returns cancel promptly while native termination is pending, remains busy', async () => {
  harness.terminate.mockImplementation(() => new Promise(() => undefined));
  const adapter = new LocalVoiceInput('/cache', '/worker'); const abort = new AbortController();
  const audio = { samples: new Float32Array([0.1]), sampleRate: 16000 as const, language: 'en' as const };
  const pending = adapter.transcribe(audio, abort.signal); await Promise.resolve(); abort.abort();
  expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  expect(await adapter.transcribe(audio, new AbortController().signal)).toEqual({ ok: false, code: 'busy' });
  harness.workers[0]?.emit('message', { ok: true, value: 'Late' });
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
