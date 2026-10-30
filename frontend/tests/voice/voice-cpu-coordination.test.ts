import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceInferenceCoordinator } from '../../src/infrastructure/voice/inference-coordinator';
import { LocalVoiceInput } from '../../src/infrastructure/voice/voice-input-adapter';
import { LocalSpeechSynthesizer } from '../../src/infrastructure/voice-output/local-speech-synthesizer';
const native = vi.hoisted(() => ({ recognition: [] as EventEmitter[], synthesis: [] as EventEmitter[], exitOnKill: true, terminateReject: false }));
vi.mock('node:worker_threads', () => ({ Worker: class extends EventEmitter {
  constructor() { super(); native.recognition.push(this); }
  postMessage() {}
  terminate() { if (native.terminateReject) return Promise.reject(new Error('Synthetic teardown failure')); return new Promise<number>(resolve => this.once('exit', () => resolve(0))); }
} }));
vi.mock('electron', () => ({ utilityProcess: { fork: () => {
  const child = new class extends EventEmitter { postMessage() {} kill() { if (native.exitOnKill) this.emit('exit', 0); return true; } }();
  native.synthesis.push(child); return child;
} } }));
vi.mock('../../src/infrastructure/voice/model-cache', () => ({ verifiedFile: async () => true,
  VoiceModelCache: class { directory = '/verified'; verify = async () => true; } }));
afterEach(() => { vi.useRealTimers(); native.exitOnKill = true; native.terminateReject = false; native.recognition.length = 0; native.synthesis.length = 0; });
it.each([false, true])('waits for cancelled STT native exit even when terminate rejects=%s', async rejects => {
  native.terminateReject = rejects;
  const coordinator = new VoiceInferenceCoordinator();
  const stt = new LocalVoiceInput('/cache', '/stt', '/cache', coordinator);
  const tts = new LocalSpeechSynthesizer('/cache', '/tts', coordinator);
  const recognitionAbort = new AbortController(), speechAbort = new AbortController();
  const recognition = stt.transcribe({ sampleRate: 16000, language: 'ru', samples: new Float32Array([0.1]) }, recognitionAbort.signal);
  await vi.waitFor(() => expect(native.recognition).toHaveLength(1));
  recognitionAbort.abort();
  expect(await recognition).toEqual({ ok: false, code: 'cancelled' });
  const speech = tts.synthesize('Привет!', 'ru', speechAbort.signal); const settled = speech.catch(() => undefined);
  try {
    await Promise.resolve(); await Promise.resolve();
    expect(native.synthesis).toHaveLength(0);
    native.recognition[0]!.emit('exit', 0);
    await vi.waitFor(() => expect(native.synthesis).toHaveLength(1));
    native.synthesis[0]!.emit('message', { id: 1, ok: true, samples: new Float32Array([0.1]) });
    expect((await speech).samples.length).toBe(1);
  } finally {
    speechAbort.abort(); native.recognition[0]!.emit('exit', 0); await settled;
    await stt.dispose(); await tts.dispose();
  }
});

it('holds TTS admission until native exit before allowing STT', async () => {
  native.exitOnKill = false;
  const coordinator = new VoiceInferenceCoordinator();
  const stt = new LocalVoiceInput('/cache', '/stt', '/cache', coordinator);
  const tts = new LocalSpeechSynthesizer('/cache', '/tts', coordinator);
  const abort = new AbortController();
  const speech = tts.synthesize('Привет!', 'ru', abort.signal); const rejected = expect(speech).rejects.toThrow();
  await vi.waitFor(() => expect(native.synthesis).toHaveLength(1));
  abort.abort(); await rejected;
  const transcript = stt.transcribe({ sampleRate: 16000, language: 'ru', samples: new Float32Array([0.1]) }, new AbortController().signal);
  await Promise.resolve(); await Promise.resolve(); expect(native.recognition).toHaveLength(0);
  native.synthesis[0]!.emit('exit', 0);
  await vi.waitFor(() => expect(native.recognition).toHaveLength(1));
  native.recognition[0]!.emit('message', { requestId: 1, ok: true, value: 'Привет' });
  expect(await transcript).toEqual({ ok: true, value: 'Привет' });
  native.exitOnKill = true;
  const disposed = stt.dispose(); native.recognition[0]!.emit('exit', 0); await disposed; await tts.dispose();
});
it.each(['abort', 'timeout'] as const)('removes a waiting TTS on %s with no late native start', async reason => {
  vi.useFakeTimers();
  const coordinator = new VoiceInferenceCoordinator(), abort = new AbortController();
  const release = coordinator.tryAcquire()!;
  const tts = new LocalSpeechSynthesizer('/cache', '/tts', coordinator);
  const speech = tts.synthesize('Привет!', 'ru', abort.signal); const rejected = expect(speech).rejects.toThrow();
  await Promise.resolve();
  await expect(tts.synthesize('Ещё!', 'ru', new AbortController().signal)).rejects.toThrow();
  if (reason === 'abort') abort.abort(); else await vi.advanceTimersByTimeAsync(120_000);
  await rejected; release(); await Promise.resolve();
  expect(native.synthesis).toHaveLength(0); await tts.dispose();
});

it('releases a crashed STT lease only on native exit and suppresses its late message', async () => {
  const coordinator = new VoiceInferenceCoordinator();
  const stt = new LocalVoiceInput('/cache', '/stt', '/cache', coordinator);
  const tts = new LocalSpeechSynthesizer('/cache', '/tts', coordinator);
  const transcript = stt.transcribe({ sampleRate: 16000, language: 'ru', samples: new Float32Array([0.1]) }, new AbortController().signal);
  await vi.waitFor(() => expect(native.recognition).toHaveLength(1));
  const speech = tts.synthesize('Привет!', 'ru', new AbortController().signal);
  await Promise.resolve(); expect(native.synthesis).toHaveLength(0);
  native.recognition[0]!.emit('exit', 134);
  expect(await transcript).toEqual({ ok: false, code: 'recognition_failed' });
  native.recognition[0]!.emit('message', { requestId: 1, ok: true, value: 'Late' });
  await vi.waitFor(() => expect(native.synthesis).toHaveLength(1));
  native.synthesis[0]!.emit('message', { id: 1, ok: true, samples: new Float32Array([0.1]) });
  await speech; await stt.dispose(); await tts.dispose();
});
it('cancels waiting STT without late worker creation and rejects duplicate admission', async () => {
  const coordinator = new VoiceInferenceCoordinator(), abort = new AbortController();
  const release = coordinator.tryAcquire()!;
  const stt = new LocalVoiceInput('/cache', '/stt', '/cache', coordinator);
  const audio = { sampleRate: 16000 as const, language: 'ru' as const, samples: new Float32Array([0.1]) };
  const pending = stt.transcribe(audio, abort.signal);
  await Promise.resolve(); await Promise.resolve();
  expect(await stt.transcribe(audio, new AbortController().signal)).toEqual({ ok: false, code: 'busy' });
  abort.abort(); expect(await pending).toEqual({ ok: false, code: 'cancelled' });
  release(); await Promise.resolve(); expect(native.recognition).toHaveLength(0); await stt.dispose();
});

it('retains admission after STT retirement deadline until a real late exit', async () => {
  vi.useFakeTimers(); native.terminateReject = true;
  const coordinator = new VoiceInferenceCoordinator(), abort = new AbortController();
  const stt = new LocalVoiceInput('/cache', '/stt', '/cache', coordinator);
  const tts = new LocalSpeechSynthesizer('/cache', '/tts', coordinator);
  const audio = { sampleRate: 16000 as const, language: 'ru' as const, samples: new Float32Array([0.1]) };
  const transcription = stt.transcribe(audio, abort.signal); await Promise.resolve();
  abort.abort(); await transcription;
  const speech = tts.synthesize('Привет!', 'ru', new AbortController().signal); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(3000);
  expect(native.synthesis).toHaveLength(0);
  expect(await stt.transcribe(audio, new AbortController().signal)).toEqual({ ok: false, code: 'busy' });
  native.recognition[0]!.emit('exit', 0); await vi.advanceTimersByTimeAsync(0);
  expect(native.synthesis).toHaveLength(1);
  native.synthesis[0]!.emit('message', { id: 1, ok: true, samples: new Float32Array([0.1]) });
  await speech; await stt.dispose(); await tts.dispose();
});
