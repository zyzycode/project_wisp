import { Worker } from 'node:worker_threads';
import type { IVoiceInput, VoiceAudioInput, VoiceInputResult, VoiceModelStatus } from '../../application/ports/voice-input.port';
import { VoiceModelCache } from './model-cache';
import { VOICE_MODEL } from './model-manifest';

export class LocalVoiceInput implements IVoiceInput {
  private status: VoiceModelStatus = { state: 'not_installed', downloadedBytes: 0, totalBytes: VOICE_MODEL.totalBytes };
  private worker: Worker | null = null;
  private disposed = false;
  private recognizing = false;
  private preparing = false;
  private sequence = 0;
  private cancelRecognition?: () => void;
  private terminating: Promise<void> | null = null;
  private readonly cache: VoiceModelCache;
  constructor(root: string, private readonly workerPath: string, bundleRoot = root) {
    // Native ORT reads the process environment before SDK APIs exist.
    process.env.ORT_DISABLE_TELEMETRY = '1';
    this.cache = new VoiceModelCache(bundleRoot);
  }
  public getStatus(): VoiceModelStatus { return { ...this.status }; }
  public async initialize(): Promise<void> {
    const valid = await this.cache.verify();
    if (!this.disposed && !this.preparing) this.status = { ...this.status, state: valid ? 'ready' : 'error', downloadedBytes: valid ? VOICE_MODEL.totalBytes : 0 };
  }
  public async prepare(signal: AbortSignal): Promise<VoiceInputResult<void>> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (this.preparing || this.recognizing) return { ok: false, code: 'busy' };
    this.preparing = true;
    try {
      if (!await this.cache.verify(signal)) {
        this.status = { ...this.status, state: 'error', downloadedBytes: 0 };
        return { ok: false, code: 'integrity_failed' };
      }
      if (this.disposed || signal.aborted) return { ok: false, code: 'cancelled' };
      this.status = { ...this.status, state: 'ready', downloadedBytes: VOICE_MODEL.totalBytes };
      return { ok: true, value: undefined };
    } catch { return { ok: false, code: 'cancelled' }; }
    finally { this.preparing = false; }
  }
  public async transcribe(audio: VoiceAudioInput, signal: AbortSignal): Promise<VoiceInputResult<string>> {
    if (this.disposed) return { ok: false, code: 'unavailable' };
    if (this.terminating || this.preparing || this.recognizing) return { ok: false, code: 'busy' };
    this.recognizing = true;
    try { return await this.recognize(audio, signal); } finally { this.recognizing = false; }
  }
  private retire(worker: Worker): void {
    if (this.terminating) return;
    this.terminating = worker.terminate().then(() => undefined, () => undefined).then(() => {
      if (this.worker === worker) this.worker = null;
      this.terminating = null;
    });
  }
  private async recognize(audio: VoiceAudioInput, signal: AbortSignal): Promise<VoiceInputResult<string>> {
    if (signal.aborted) return { ok: false, code: 'cancelled' };
    if (audio.sampleRate !== 16000 || audio.samples.length < 1 || audio.samples.length > 480000 || !audio.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)) return { ok: false, code: 'invalid_audio' };
    try {
      if (!await this.cache.verify(signal)) { this.status = { ...this.status, state: 'error' }; return { ok: false, code: 'integrity_failed' }; }
    } catch { return { ok: false, code: 'cancelled' }; }
    if (signal.aborted || this.disposed) return { ok: false, code: 'cancelled' };
    if (audio.samples.every(n => Math.abs(n) < 0.0001)) return { ok: true, value: '' };
    return new Promise(resolve => {
      let worker: Worker;
      try {
        if (!this.worker) {
          this.worker = new Worker(this.workerPath, { workerData: { modelPath: this.cache.directory } });
          const created = this.worker;
          created.on('error', () => undefined);
          created.once('exit', () => { if (this.worker === created) this.worker = null; });
        }
        worker = this.worker;
      } catch { resolve({ ok: false, code: 'unavailable' }); return; }
      const requestId = ++this.sequence;
      let settled = false;
      const finish = (result: VoiceInputResult<string>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        worker.removeListener('message', message);
        worker.removeListener('error', failed);
        worker.removeListener('exit', failed);
        this.cancelRecognition = undefined;
        if (!result.ok) this.retire(worker);
        resolve(result);
      };
      const abort = () => finish({ ok: false, code: 'cancelled' });
      const failed = () => finish({ ok: false, code: 'recognition_failed' });
      const message = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('requestId' in value) || value.requestId !== requestId) return;
        if ('ok' in value && value.ok === true && 'value' in value && typeof value.value === 'string') finish({ ok: true, value: value.value });
        else failed();
      };
      const timeout = setTimeout(() => finish({ ok: false, code: 'timeout' }), 60000);
      this.cancelRecognition = abort;
      signal.addEventListener('abort', abort, { once: true });
      worker.on('message', message);
      worker.once('error', failed);
      worker.once('exit', failed);
      if (signal.aborted) abort();
      else {
        try { worker.postMessage({ requestId, samples: audio.samples, language: audio.language }); }
        catch { finish({ ok: false, code: 'unavailable' }); }
      }
    });
  }
  public async dispose(): Promise<void> {
    this.disposed = true;
    this.cancelRecognition?.();
    if (this.worker && !this.terminating) this.retire(this.worker);
    await this.terminating;
  }
}
