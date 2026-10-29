import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import type { ISpeechSynthesizer, SynthesizedSpeech } from '../../application/ports/reply-output.port';
import { verifiedFile } from '../voice/model-cache';
import { TTS_MODEL, TTS_TOKENIZER } from './model-manifest';
export class LocalSpeechSynthesizer implements ISpeechSynthesizer {
  private child: UtilityProcess | null = null;
  private retiring = false;
  private readonly exited = new WeakSet<UtilityProcess>();
  private sequence = 0;
  private disposed = false;
  private pending?: () => void;
  private terminating: Promise<void> = Promise.resolve();
  constructor(private readonly resources: string, private readonly entryPath: string) { process.env.ORT_DISABLE_TELEMETRY = '1'; }
  public async ready(): Promise<boolean> {
    for (const manifest of [TTS_MODEL, TTS_TOKENIZER]) {
      for (const file of manifest.files) if (!await verifiedFile(path.join(this.resources, 'voice-models', manifest.revision, file.path), file)) return false;
    }
    return !this.disposed;
  }
  public async synthesize(text: string, language: 'ru' | 'en', signal: AbortSignal): Promise<SynthesizedSpeech> {
    const started = performance.now();
    if (this.disposed || this.pending || signal.aborted) throw new Error('Speech unavailable');
    await this.terminating;
    if (this.disposed || this.pending || this.retiring || signal.aborted) throw new Error('Speech cancelled');
    if (!this.child) {
      const env: Record<string, string> = { ORT_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
      for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH']) {
        const value = process.env[name]; if (value !== undefined) env[name] = value;
      }
      this.child = utilityProcess.fork(this.entryPath, [], { serviceName: 'Wisp speech synthesis', stdio: 'ignore', env });
      const child = this.child;
      child.on('error', () => undefined);
      child.once('exit', () => { this.exited.add(child); if (this.child === child) this.child = null; });
    }
    const child = this.child;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (samples?: Float32Array) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
        child.removeListener('message', message); child.removeListener('error', abort); child.removeListener('exit', abort);
        this.pending = undefined;
        if (samples) resolve({ samples, sampleRate: 24000 });
        else {
          this.retire(child);
          reject(new Error('Speech synthesis unavailable'));
        }
      };
      const abort = () => finish();
      const message = (value: unknown) => {
        if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) return;
        if ('ok' in value && value.ok === true && 'samples' in value && value.samples instanceof Float32Array && value.samples.length > 0 && value.samples.length <= 2_880_000 && value.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1)) finish(value.samples);
        else finish();
      };
      const timer = setTimeout(abort, Math.max(0, 120_000 - (performance.now() - started)));
      this.pending = abort;
      signal.addEventListener('abort', abort, { once: true });
      child.on('message', message); child.once('error', abort); child.once('exit', abort);
      if (signal.aborted) abort();
      else { try { child.postMessage({ id, text, language,
        modelRoot: path.join(this.resources, 'voice-models', TTS_MODEL.revision),
        tokenizerRoot: path.join(this.resources, 'voice-models', TTS_TOKENIZER.revision),
      }); } catch { abort(); } }
    });
  }
  private retire(child: UtilityProcess): void {
    if (this.exited.has(child)) return;
    if (this.retiring) return;
    this.retiring = true;
    this.terminating = new Promise(resolve => {
      const hardKill = setTimeout(() => {
        if (this.child !== child || !this.retiring || child.pid === undefined) return;
        try { process.kill(child.pid, 'SIGKILL'); } catch { /* Exit may already be queued. */ }
      }, 2000);
      const deadline = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(hardKill); clearTimeout(deadline);
        if (this.child === child) this.child = null;
        this.retiring = false; resolve();
      });
      try { child.kill(); } catch { /* Keep ownership until exit, including after the deadline. */ }
    });
  }
  public async dispose(): Promise<void> {
    this.disposed = true; this.pending?.();
    if (this.child) this.retire(this.child);
    await this.terminating;
  }
}
