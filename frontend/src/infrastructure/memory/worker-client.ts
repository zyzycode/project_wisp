import { Worker } from 'node:worker_threads';
import type { MemoryResult } from '../../application/ports/memory-repository.interface';
import { command, failure, reply, responseValue, type Command, type Operation } from './protocol';

export interface MemoryWorker {
  postMessage(value: unknown): void;
  on(event: 'message', listener: (value: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  terminate(): Promise<number>;
}
interface Pending { command: Command; readonly resolve: (result: MemoryResult<unknown>) => void }
const unavailable: MemoryResult<never> = { ok: false, code: 'unavailable' };

/** Serial transport with bounded admission; no SQL is executed on Main. */
export class MemoryWorkerClient {
  readonly ready: Promise<MemoryResult<void>>;
  private resolveReady!: (result: MemoryResult<void>) => void;
  private readonly exited: Promise<void>;
  private resolveExit!: () => void;
  private readonly worker: MemoryWorker;
  private operationTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly startupTimer: ReturnType<typeof setTimeout>;
  private queue: Pending[] = [];
  private active: Pending | undefined;
  private nextId = 1;
  private state: 'starting' | 'ready' | 'closing' | 'failed' | 'closed' = 'starting';
  private closePromise: Promise<void> | undefined;

  constructor(options: { readonly workerPath: string; readonly filename: string; readonly now: string; readonly createWorker?: () => MemoryWorker; readonly startupDeadlineMs?: number }) {
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    this.exited = new Promise(resolve => { this.resolveExit = resolve; });
    this.startupTimer = setTimeout(() => { this.fail(); void this.worker.terminate(); }, options.startupDeadlineMs ?? 10_000);
    try {
      this.worker = options.createWorker?.() ?? new Worker(options.workerPath, { workerData: { filename: options.filename, now: options.now } });
      this.worker.on('message', value => this.receive(value));
      this.worker.on('error', () => { this.fail(); void this.worker.terminate(); });
      this.worker.on('exit', () => { if (this.state !== 'closed') this.fail(); this.resolveExit(); });
    } catch {
      // A worker construction failure is the same capability fallback as addon-load failure.
      this.worker = { postMessage: () => {}, on() { return this; }, terminate: async () => 0 };
      this.fail(); this.resolveExit();
    }
  }
  request(operation: Operation, payload: unknown, generation: number): Promise<MemoryResult<unknown>> {
    if (this.state !== 'ready') return Promise.resolve(unavailable);
    let c: Command;
    try { c = command({ id: this.nextId++, operation, payload, generation }); } catch (error) { return Promise.resolve(failure(error)); }
    const control = operation === 'clear' || operation === 'close';
    const replacesCheckpoint = operation === 'saveSnapshot' && this.queue.some(p => p.command.operation === 'saveSnapshot' && p.command.generation === generation);
    if ((control && this.queue.some(p => p.command.operation === operation)) || (!control && !replacesCheckpoint && this.queue.filter(p => p.command.operation !== 'clear' && p.command.operation !== 'close').length >= 100)) return Promise.resolve({ ok: false, code: 'busy' });
    return new Promise(resolve => {
      if (operation === 'saveSnapshot') {
        const previous = this.queue.findIndex(p => p.command.operation === 'saveSnapshot' && p.command.generation === generation);
        if (previous >= 0) {
          // Replaced checkpoints were not durably committed; acknowledge only the latest request.
          this.queue.splice(previous, 1)[0]?.resolve({ ok: false, code: 'stale' });
        }
      }
      this.queue.push({ command: c, resolve });
      this.pump();
    });
  }
  /** Early Character input abandons startup; a late ready message cannot re-enable persistence. */
  abandonStartup(): void { if (this.state === 'starting') { this.fail(); void this.worker.terminate(); } }
  async abort(): Promise<void> { this.fail(); await this.worker.terminate(); await this.exited; }
  close(generation: number): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.shutdown(generation);
    return this.closePromise;
  }
  private async shutdown(generation: number): Promise<void> {
    const timer = setTimeout(() => { this.fail(); void this.worker.terminate(); }, 7000);
    try {
      if (this.state === 'ready') {
        const result = this.request('close', null, generation);
        this.state = 'closing';
        await result;
      } else if (this.state !== 'closed') { this.fail(); await this.worker.terminate(); }
      await this.exited;
    } finally { clearTimeout(timer); }
  }
  private pump(): void {
    if (this.active || (this.state !== 'ready' && this.state !== 'closing')) return;
    this.active = this.queue.shift();
    if (!this.active) return;
    this.operationTimer = setTimeout(() => { this.fail(); void this.worker.terminate(); }, 10_000);
    try { this.worker.postMessage(this.active.command); } catch { this.fail(); void this.worker.terminate(); }
  }
  private receive(input: unknown): void {
    if (this.state === 'failed' || this.state === 'closed') return;
    try {
      const r = reply(input);
      if (this.state === 'starting') {
        if (r.id !== 0 || (r.result.ok && r.result.value !== undefined)) throw new Error('Invalid ready');
        clearTimeout(this.startupTimer);
        if (r.result.ok) { this.state = 'ready'; this.resolveReady({ ok: true, value: undefined }); }
        else { this.resolveReady(r.result); this.fail(); void this.worker.terminate(); }
        return;
      }
      if (!this.active || r.id !== this.active.command.id) throw new Error('Unexpected acknowledgment');
      clearTimeout(this.operationTimer); this.operationTimer = undefined;
      const operation = this.active.command.operation;
      const result = r.result.ok ? { ok: true as const, value: responseValue(operation, r.result.value) } : r.result;
      this.active.resolve(result); this.active = undefined;
      if (operation === 'close') { this.state = 'closed'; return; }
      if (!r.result.ok && ['unavailable', 'storage_full', 'corrupt', 'io_error', 'unsupported_version'].includes(r.result.code)) { this.fail(); void this.worker.terminate(); return; }
      this.pump();
    } catch { this.fail(); void this.worker.terminate(); }
  }
  private fail(): void {
    clearTimeout(this.startupTimer); clearTimeout(this.operationTimer); this.operationTimer = undefined;
    this.state = 'failed';
    this.resolveReady(unavailable);
    this.active?.resolve(unavailable); this.active = undefined;
    for (const pending of this.queue.splice(0)) pending.resolve(unavailable);
  }
}
