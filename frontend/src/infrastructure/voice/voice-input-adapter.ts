import { Worker } from 'node:worker_threads';
import type { IVoiceInput, VoiceAudioInput, VoiceInputResult, VoiceModelStatus } from '../../application/ports/voice-input.port';
import { VoiceCacheError, VoiceModelCache } from './model-cache';
import { VOICE_MODEL } from './model-manifest';
export class LocalVoiceInput implements IVoiceInput {
  private status: VoiceModelStatus = { state: 'not_installed', downloadedBytes: 0, totalBytes: VOICE_MODEL.totalBytes };
  private worker: Worker | null = null;
  private disposed = false;
  private recognizing = false;
  private setup: AbortController | null = null;
  private readonly cache: VoiceModelCache;
  constructor(root: string, private readonly workerPath: string) {
    // Native ORT reads the process environment at initialization, before SDK APIs exist.
    // Set this in Main (worker process.env changes do not update native getenv).
    process.env.ORT_DISABLE_TELEMETRY = '1';
    this.cache = new VoiceModelCache(root);
  }
  public getStatus(): VoiceModelStatus { return { ...this.status }; }
  public async initialize(): Promise<void> {
    if (await this.cache.verify() && !this.disposed && !this.setup) this.status = { ...this.status, state: 'ready', downloadedBytes: VOICE_MODEL.totalBytes };
  }
  public async prepare(signal: AbortSignal): Promise<VoiceInputResult<void>> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (this.setup || this.worker || this.recognizing) return { ok: false, code: 'busy' };
    const setup = new AbortController(); this.setup = setup;
    const abort = () => setup.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) setup.abort();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; setup.abort(); }, 600000);
    this.status = { ...this.status, state: 'downloading', downloadedBytes: 0 };
    try {
      await this.cache.prepare(setup.signal, bytes => { this.status = { ...this.status, downloadedBytes: bytes }; });
      setup.signal.throwIfAborted(); this.status = { ...this.status, state: 'ready' };
      return { ok: true, value: undefined };
    } catch (error) {
      this.status = { ...this.status, state: 'error' };
      return { ok: false, code: timedOut ? 'timeout' : setup.signal.aborted ? 'cancelled' : error instanceof VoiceCacheError ? error.code : 'download_failed' };
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); this.setup = null; }
  }
  public async transcribe(audio: VoiceAudioInput, signal: AbortSignal): Promise<VoiceInputResult<string>> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (this.worker || this.setup || this.recognizing) return { ok: false, code: 'busy' };
    this.recognizing = true;
    try { return await this.recognize(audio, signal); } finally { this.recognizing = false; }
  }
  private async recognize(audio: VoiceAudioInput, signal: AbortSignal): Promise<VoiceInputResult<string>> {
    if (signal.aborted) return { ok: false, code: 'cancelled' };
    if (audio.sampleRate !== 16000 || audio.samples.length < 1 || audio.samples.length > 480000 || !audio.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)) return { ok: false, code: 'invalid_audio' };
    try {
      if (!await this.cache.verify(signal)) { this.status = { ...this.status, state: 'error' }; return { ok: false, code: 'integrity_failed' }; }
    } catch { return { ok: false, code: 'cancelled' }; }
    if (signal.aborted || this.disposed) return { ok: false, code: 'cancelled' };
    // Reject silence before a generative decoder can hallucinate speech.
    if (audio.samples.every(n => Math.abs(n) < 0.0001)) return { ok: true, value: '' };
    return new Promise(resolve => {
      let worker: Worker;
      try { worker = new Worker(this.workerPath, { workerData: { modelPath: this.cache.directory, samples: audio.samples, language: audio.language } }); }
      catch { resolve({ ok: false, code: 'unavailable' }); return; }
      this.worker = worker; let settled = false;
      const finish = (result: VoiceInputResult<string>) => {
        if (settled) return; settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort);
        resolve(result);
        void worker.terminate().then(() => { if (this.worker === worker) this.worker = null; }, () => undefined);
      };
      const abort = () => finish({ ok: false, code: 'cancelled' });
      const timeout = setTimeout(() => finish({ ok: false, code: 'timeout' }), 60000);
      signal.addEventListener('abort', abort, { once: true });
      worker.once('message', (value: unknown) => {
        if (value && typeof value === 'object' && 'ok' in value && value.ok === true && 'value' in value && typeof value.value === 'string') finish({ ok: true, value: value.value });
        else finish({ ok: false, code: 'recognition_failed' });
      });
      worker.once('error', () => finish({ ok: false, code: 'recognition_failed' }));
      worker.once('exit', () => finish({ ok: false, code: 'recognition_failed' }));
      if (signal.aborted) abort();
    });
  }
  public async dispose(): Promise<void> { this.disposed = true; this.setup?.abort(); void this.worker?.terminate().catch(() => undefined); }
}
