import { mkdir, open, unlink } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import path from 'node:path';
import type { ISummaryCache, SummaryCache, ActiveSummaryReceipt } from '../../application/ports/summary';
import type { MemoryResult } from '../../application/ports/memory-repository.interface';
import { parseSummaryCache, parseSummaryReceipt } from './summary-cache-validation';
export { parseSummaryCache } from './summary-cache-validation';
const empty: SummaryCache = { formatVersion: 2, entry: null, receipt: null };
/** Single local bounded file, serialized staging and synchronous atomic commit barrier. */
export class FileSummaryCache implements ISummaryCache {
  private generation = 0;
  private disposed = false;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filename: string, private readonly now: () => number = Date.now) {}
  invalidate(): number { return ++this.generation; }
  private async raw(): Promise<unknown> {
    const file = await open(this.filename, 'r');
    try {
      if ((await file.stat()).size > 32768) throw new TypeError('Cache size');
      const bytes = Buffer.alloc(32769); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 32768) throw new TypeError('Cache size');
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead))) as unknown;
    } finally { await file.close(); }
  }
  async read(): Promise<MemoryResult<SummaryCache>> {
    try { return { ok: true, value: parseSummaryCache(await this.raw()) }; }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { ok: true, value: empty };
      return { ok: false, code: 'corrupt' };
    }
  }
  private async retainedReceipt(): Promise<ActiveSummaryReceipt> {
    try {
      const raw = await this.raw();
      if (raw && typeof raw === 'object' && 'receipt' in raw) {
        const existing = parseSummaryReceipt(raw.receipt, !('mode' in Object(raw.receipt)));
        if (existing) return existing;
      }
    } catch { /* Malformed metadata cannot establish an earlier admission. */ }
    return { commandId: 'corrupt-cache-quarantine', requestId: 'corrupt-cache-quarantine', sourceDigest: '0'.repeat(64), admittedAt: this.now(), mode: 'dialogue_pairs', generatorVersion: 1 };
  }
  write(value: SummaryCache, generation: number): Promise<MemoryResult<void>> {
    return this.enqueue(() => this.commit(value, generation));
  }
  private async commit(value: SummaryCache, generation: number): Promise<MemoryResult<void>> {
    const temporary = `${this.filename}.tmp`;
    try {
      if (this.disposed || generation !== this.generation) return { ok: false, code: 'stale' };
      const body = JSON.stringify(parseSummaryCache(value));
      if (Buffer.byteLength(body) > 32768) return { ok: false, code: 'invalid_data' };
      await mkdir(path.dirname(this.filename), { recursive: true });
      const staged = await open(temporary, 'w', 0o600);
      try { await staged.writeFile(body, 'utf8'); await staged.sync(); } finally { await staged.close(); }
      if (this.disposed || generation !== this.generation) return { ok: false, code: 'stale' };
      // No asynchronous gap between checking the barrier and replacing the file.
      renameSync(temporary, this.filename);
      return { ok: true, value: undefined };
    } catch { return { ok: false, code: 'io_error' }; }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  clear(resetReceipt: boolean, explicit = true): Promise<MemoryResult<void>> {
    const generation = this.invalidate();
    return this.enqueue(async () => {
      if (this.disposed || generation !== this.generation) return { ok: false, code: 'stale' };
      if (resetReceipt) {
        try { await unlink(this.filename).catch(error => { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }); await unlink(`${this.filename}.tmp`).catch(() => undefined); return { ok: true, value: undefined }; }
        catch { return { ok: false, code: 'io_error' }; }
      }
      const existing = await this.read();
      if (!existing.ok && !explicit) return { ok: false, code: 'corrupt' };
      // Corrupt metadata cannot prove that the last attempt was over 24h ago.
      const retained = existing.ok ? existing.value.receipt : await this.retainedReceipt();
      return this.commit({ ...empty, receipt: retained }, generation);
    });
  }
  dispose(): void { this.disposed = true; this.invalidate(); }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.then(operation, operation); this.queue = next.catch(() => undefined); return next; }
}
