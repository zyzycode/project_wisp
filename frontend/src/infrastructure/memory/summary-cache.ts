import { summaryPlainText } from '../../shared/summary-text-validation';
import { mkdir, open, unlink } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import path from 'node:path';
import type { ISummaryCache, SummaryCache, SummaryEntry, SummaryReceipt } from '../../application/ports/summary';
import type { MemoryResult } from '../../application/ports/memory-repository.interface';
import { exactRecord } from '../../shared/dialogue-ipc-validation';
import { summarySources } from './summary-source-reader';
const empty: SummaryCache = { formatVersion: 1, entry: null, receipt: null };
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Invalid digest'); return value; }
function receipt(value: unknown): SummaryReceipt | null {
  if (value === null) return null;
  const r = exactRecord(value, ['commandId', 'requestId', 'sourceDigest', 'admittedAt', 'generatorVersion']);
  if (r.generatorVersion !== 1 || typeof r.admittedAt !== 'number' || !Number.isSafeInteger(r.admittedAt) || r.admittedAt < 0) throw new TypeError('Invalid receipt');
  return { commandId: summaryPlainText(r.commandId, 128), requestId: summaryPlainText(r.requestId, 128), sourceDigest: digest(r.sourceDigest), admittedAt: r.admittedAt, generatorVersion: 1 };
}
export function parseSummaryCache(value: unknown): SummaryCache {
  const r = exactRecord(value, ['formatVersion', 'entry', 'receipt']);
  if (r.formatVersion !== 1) throw new TypeError('Unsupported cache');
  let entry: SummaryEntry | null = null;
  if (r.entry !== null) {
    const e = exactRecord(r.entry, ['text', 'sources', 'sourceDigest', 'factsDigest', 'locale', 'generatorVersion']);
    if (e.generatorVersion !== 1 || (e.locale !== 'ru' && e.locale !== 'en')) throw new TypeError('Invalid entry');
    const sources = summarySources(e.sources);
    if (sources.some(source => source.sessionId !== sources[0]?.sessionId) || new Set(sources.flatMap(source => [source.userMessageId, source.assistantMessageId])).size !== sources.length * 2) throw new TypeError('Invalid coverage');
    for (const source of sources) digest(source.revision);
    entry = { text: summaryPlainText(e.text, 1200), sources, sourceDigest: digest(e.sourceDigest), factsDigest: digest(e.factsDigest), locale: e.locale, generatorVersion: 1 };
  }
  const admitted = receipt(r.receipt);
  if (entry && (!admitted || entry.sourceDigest !== admitted.sourceDigest)) throw new TypeError('Missing receipt');
  return { formatVersion: 1, entry, receipt: admitted };
}
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
  private async retainedReceipt(): Promise<SummaryReceipt> {
    try {
      const raw = await this.raw();
      if (raw && typeof raw === 'object' && 'receipt' in raw) {
        const existing = receipt(raw.receipt);
        if (existing) return existing;
      }
    } catch { /* Malformed metadata cannot establish an earlier admission. */ }
    return { commandId: 'corrupt-cache-quarantine', requestId: 'corrupt-cache-quarantine', sourceDigest: '0'.repeat(64), admittedAt: this.now(), generatorVersion: 1 };
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
