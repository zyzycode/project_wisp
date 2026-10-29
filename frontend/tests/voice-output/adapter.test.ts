import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalSpeechSynthesizer } from '../../src/infrastructure/voice-output/local-speech-synthesizer';
const harness = vi.hoisted(() => ({ workers: [] as EventEmitter[], post: vi.fn(), kill: vi.fn((child: EventEmitter) => { child.emit('exit', 0); return true; }), verified: vi.fn(async () => true), fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: (...args: unknown[]) => {
  harness.fork(...args);
  const child = new class extends EventEmitter { postMessage(value: unknown) { harness.post(value); } kill() { return harness.kill(this); } }();
  harness.workers.push(child); return child;
} } }));
vi.mock('../../src/infrastructure/voice/model-cache', () => ({ verifiedFile: harness.verified }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); harness.workers.length = 0; harness.post.mockClear(); harness.fork.mockClear(); harness.kill.mockReset().mockImplementation(child => { child.emit('exit', 0); return true; }); harness.verified.mockResolvedValue(true); });
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
  expect(harness.workers).toHaveLength(1); expect(harness.kill).toHaveBeenCalledOnce(); await adapter.dispose();
});
it.each(['malformed', 'timeout'] as const)('bounds %s work and retires the worker', async reason => {
  vi.useFakeTimers(); const adapter = new LocalSpeechSynthesizer('/resources', '/worker');
  const pending = adapter.synthesize('Hello!', 'en', new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow(); await Promise.resolve();
  if (reason === 'malformed') harness.workers[0]?.emit('message', { id: 1, ok: true, samples: new Float32Array([NaN]) });
  else await vi.advanceTimersByTimeAsync(120000);
  await rejected; expect(harness.kill).toHaveBeenCalledOnce(); await adapter.dispose();
});
it('keeps ownership after retirement deadline and never overlaps an unreaped native child', async () => {
  vi.useFakeTimers(); harness.kill.mockReturnValue(true);
  const adapter = new LocalSpeechSynthesizer('/resources', '/worker'); const abort = new AbortController();
  const pending = adapter.synthesize('Привет!', 'ru', abort.signal); const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve(); abort.abort(); await rejected;
  const next = adapter.synthesize('Ещё!', 'ru', new AbortController().signal); const unavailable = expect(next).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(3000); await unavailable; expect(harness.workers).toHaveLength(1);
  harness.workers[0]?.emit('exit', 0); await adapter.dispose();
});
it('isolates native exit, rejects pending once and permits a fresh child afterward', async () => {
  const adapter = new LocalSpeechSynthesizer('/resources', '/worker');
  const pending = adapter.synthesize('Привет!', 'ru', new AbortController().signal); const rejected = expect(pending).rejects.toThrow();
  await Promise.resolve(); harness.workers[0]?.emit('exit', 134); await rejected;
  const next = adapter.synthesize('Ещё!', 'ru', new AbortController().signal); await Promise.resolve();
  expect(harness.workers).toHaveLength(2);
  harness.workers[1]?.emit('message', { id: 2, ok: true, samples: new Float32Array([0.1]) });
  await expect(next).resolves.toMatchObject({ sampleRate: 24000 }); await adapter.dispose();
});
it('does not inherit provider credentials into native inference process', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-secret'); vi.stubEnv('WISP_BACKEND_SESSION_TOKEN', 'synthetic-session');
  const adapter = new LocalSpeechSynthesizer('/resources', '/worker'); const abort = new AbortController();
  const pending = adapter.synthesize('Привет!', 'ru', abort.signal); const rejected = expect(pending).rejects.toThrow(); await Promise.resolve();
  expect(harness.fork.mock.calls[0]?.[2]).toMatchObject({ stdio: 'ignore', env: { ORT_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1' } });
  const options: unknown = harness.fork.mock.calls[0]?.[2];
  expect(JSON.stringify(options)).not.toContain('synthetic-secret'); expect(JSON.stringify(options)).not.toContain('synthetic-session');
  abort.abort(); await rejected; await adapter.dispose();
});
