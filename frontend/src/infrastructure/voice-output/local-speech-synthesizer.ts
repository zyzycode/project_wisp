import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { ISpeechSynthesizer, SynthesizedSpeech } from '../../application/ports/reply-output.port';
import { verifiedFile } from '../voice/model-cache';
import { TTS_MODEL, TTS_TOKENIZER } from './model-manifest';
export class LocalSpeechSynthesizer implements ISpeechSynthesizer {
  private worker: Worker | null = null;
  private sequence = 0;
  private disposed = false;
  private pending?: () => void;
  private terminating: Promise<void> = Promise.resolve();
  constructor(private readonly resources: string, private readonly workerPath: string) { process.env.ORT_DISABLE_TELEMETRY = '1'; }
  public async ready(): Promise<boolean> {
    for (const manifest of [TTS_MODEL, TTS_TOKENIZER]) {
      for (const file of manifest.files) if (!await verifiedFile(path.join(this.resources, 'voice-models', manifest.revision, file.path), file)) return false;
    }
    return !this.disposed;
  }
  public async synthesize(text: string, language: 'ru' | 'en', signal: AbortSignal): Promise<SynthesizedSpeech> {
    if (this.disposed || this.pending || signal.aborted) throw new Error('Speech unavailable');
    await this.terminating;
    if (this.disposed || this.pending || signal.aborted) throw new Error('Speech cancelled');
    if (!this.worker) {
      this.worker = new Worker(this.workerPath, { workerData: {
        modelRoot: path.join(this.resources, 'voice-models', TTS_MODEL.revision),
        tokenizerRoot: path.join(this.resources, 'voice-models', TTS_TOKENIZER.revision),
      } });
      const worker = this.worker;
      worker.on('error', () => undefined);
      worker.once('exit', () => { if (this.worker === worker) this.worker = null; });
    }
    const worker = this.worker;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (samples?: Float32Array) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        worker.removeListener('message', message); worker.removeListener('error', abort); worker.removeListener('exit', abort);
        this.pending = undefined;
        if (samples) resolve({ samples, sampleRate: 24000 });
        else {
          if (this.worker === worker) this.worker = null;
          this.terminating = worker.terminate().then(() => undefined, () => undefined);
          reject(new Error('Speech synthesis unavailable'));
        }
      };
      const abort = () => finish();
      const message = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) return;
        if ('ok' in value && value.ok === true && 'samples' in value && value.samples instanceof Float32Array && value.samples.length > 0 && value.samples.length <= 2_880_000 && value.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)) finish(value.samples);
        else finish();
      };
      const timer = setTimeout(abort, 120_000);
      this.pending = abort;
      signal.addEventListener('abort', abort, { once: true });
      worker.on('message', message); worker.once('error', abort); worker.once('exit', abort);
      if (signal.aborted) abort();
      else { try { worker.postMessage({ id, text, language }); } catch { abort(); } }
    });
  }
  public async dispose(): Promise<void> {
    this.disposed = true; this.pending?.();
    if (this.worker) { const worker = this.worker; this.worker = null; await worker.terminate(); }
    await this.terminating;
  }
}
