import { summaryPlainText } from '../../shared/summary-text-validation';
import type { ISummaryCache, ISummaryGenerator, ISummaryRuntime, ISummarySourceReader, SummaryCapture, SummaryEntry, SummaryPreview, SummaryResult } from '../ports/summary';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import { factsDigest, matchesSummary, selectSummaryPairs, sourceMetadata, summaryMatchesText } from './summary-selection';
interface Options {
  readonly sources: ISummarySourceReader; readonly cache: ISummaryCache; readonly generator: ISummaryGenerator;
  readonly context: () => MemoryOperationContext | null; readonly now: () => number; readonly monotonicNow?: () => number; readonly createId: () => string;
  readonly hash: (text: string) => string; readonly scheduler: MemoryScheduler; readonly locale: 'ru' | 'en';
  readonly interruptObservation?: () => Promise<void>;
  readonly beforeRead: () => Promise<void>; readonly canGenerate: () => boolean;
}
interface Preview { readonly monotonicExpiresAt: number; readonly public: SummaryPreview; readonly entry: SummaryEntry; readonly generation: number; readonly memoryGeneration: number }
const failure = (code: 'unavailable' | 'busy' | 'stale' | 'rate_limited' | 'failed' | 'conflict'): SummaryResult<never> => ({ ok: false, code });
/** Explicit only: no startup/timer/chat inference. All async completions cross generation guards. */
export class SummaryRuntime implements ISummaryRuntime {
  private generation = 0;
  private disposed = false;
  private disabled = false;
  private clearSequence = 0;
  private selection: Preview | undefined;
  private abort: AbortController | undefined;
  private clearing: Promise<unknown> = Promise.resolve();
  private pending: { commandId: string; previewId: string; result: Promise<SummaryResult<string>> } | undefined;
  private completed: { commandId: string; previewId: string; result: SummaryResult<string> } | undefined;
  constructor(private readonly options: Options) {}
  isBusy(): boolean { return this.pending !== undefined; }
  async preview(): Promise<SummaryResult<SummaryPreview>> {
    if (this.disposed || this.disabled || !this.options.canGenerate() || !this.options.context()) return failure('unavailable');
    if (this.pending) return failure('busy');
    const generation = this.generation, context = this.options.context()!;
    try {
      const result = await this.bounded(async () => { await this.clearing; await this.options.beforeRead(); const cache = await this.options.cache.read(); return cache.ok ? this.options.sources.recent(context) : cache; }, 200);
      if (!this.current(generation, context.generation)) return failure('stale');
      if (!result.ok) return failure('unavailable');
      const pairs = selectSummaryPairs(result.value.pairs); if (pairs.length < 4) return failure('unavailable');
      const sources = sourceMetadata(pairs, this.options.hash);
      const entry: SummaryEntry = { text: 'preview', sources, sourceDigest: this.options.hash(JSON.stringify(sources)), factsDigest: factsDigest(result.value, this.options.hash), locale: this.options.locale, generatorVersion: 1 };
      const publicPreview: SummaryPreview = { previewId: this.options.createId(), expiresAt: this.options.now() + 120000, pairs: pairs.map(({ userText, assistantText }) => ({ userText, assistantText })) };
      this.selection = { monotonicExpiresAt: (this.options.monotonicNow ?? this.options.now)() + 120000, public: publicPreview, entry, generation, memoryGeneration: context.generation };
      return { ok: true, value: publicPreview };
    } catch { return failure('unavailable'); }
  }
  confirm(commandId: string, previewId: string): Promise<SummaryResult<string>> {
    if (this.pending) return this.pending.commandId === commandId ? (this.pending.previewId === previewId ? this.pending.result : Promise.resolve(failure('conflict'))) : Promise.resolve(failure('busy'));
    if (this.completed?.commandId === commandId) return Promise.resolve(this.completed.previewId === previewId ? this.completed.result : failure('conflict'));
    const preview = this.selection;
    if (!preview || preview.public.previewId !== previewId || (this.options.monotonicNow ?? this.options.now)() >= preview.monotonicExpiresAt || !this.current(preview.generation, preview.memoryGeneration)) return Promise.resolve(failure('stale'));
    if (!this.options.canGenerate()) return Promise.resolve(failure('busy'));
    const controller = new AbortController(); this.abort = controller;
    const result = this.bounded(() => this.generate(commandId, preview, controller), 15000, () => { controller.abort(); this.options.cache.invalidate(); }).catch(() => failure('failed')).then(value => {
      const outcome = this.current(preview.generation, preview.memoryGeneration) ? value : failure('stale');
      this.completed = { commandId, previewId, result: outcome };
      return outcome;
    }).finally(() => { if (this.abort === controller) this.abort = undefined; if (this.pending?.result === result) this.pending = undefined; });
    this.pending = { commandId, previewId, result }; return result;
  }
  private async generate(commandId: string, preview: Preview, controller: AbortController): Promise<SummaryResult<string>> {
    await this.options.interruptObservation?.();
    if (controller.signal.aborted) return failure('stale');
    const { entry } = preview;
    const valid = () => !controller.signal.aborted && this.current(preview.generation, preview.memoryGeneration);
    const cache = await this.bounded(async () => { await this.clearing; return this.options.cache.read(); }, 200);
    if (!valid()) return failure('stale');
    if (!cache.ok) return failure('unavailable');
    if (!await this.validate(entry, preview.generation)) return failure('stale');
    if (!valid()) return failure('stale');
    if (cache.value.receipt?.commandId === commandId && cache.value.receipt.sourceDigest !== entry.sourceDigest) return failure('conflict');
    if (cache.value.entry?.sourceDigest === entry.sourceDigest && cache.value.entry.locale === this.options.locale && await this.validate(cache.value.entry, preview.generation)) return { ok: true, value: cache.value.entry.text };
    if (cache.value.receipt?.commandId === commandId) return failure('failed');
    const now = this.options.now();
    if (cache.value.receipt && now - cache.value.receipt.admittedAt < 86400000) return failure('rate_limited');
    const receipt = { commandId, requestId: this.options.createId(), sourceDigest: entry.sourceDigest, admittedAt: now, generatorVersion: 1 as const };
    const epoch = this.options.cache.invalidate();
    const written = await this.options.cache.write({ formatVersion: 1, entry: null, receipt }, epoch);
    if (!valid()) return failure('stale');
    if (!written.ok) return failure('unavailable');
    // Source revalidation follows durable receipt too; mutation cannot sneak into dispatch.
    if (!await this.validate(entry, preview.generation) || !valid()) return failure('stale');
    const text = summaryPlainText(await this.options.generator.generateSummary({ requestId: receipt.requestId, locale: this.options.locale, pairs: preview.public.pairs }, controller.signal), 1200);
    if (!valid() || !await this.validate(entry, preview.generation) || !valid()) return failure('stale');
    const saved = await this.options.cache.write({ formatVersion: 1, entry: { ...entry, text }, receipt }, epoch);
    if (!valid()) return failure('stale');
    return saved.ok ? { ok: true, value: text } : failure('unavailable');
  }
  async capture(text: string): Promise<SummaryCapture | undefined> {
    const generation = this.generation, context = this.options.context(); if (!context || this.disposed || this.disabled) return undefined;
    try {
      return await this.bounded(async () => {
        await this.clearing; await this.options.beforeRead();
        const cache = await this.options.cache.read();
        if (!cache.ok || !cache.value.entry || !this.current(generation, context.generation)) return undefined;
        const entry = cache.value.entry;
        if (entry.locale !== this.options.locale || !summaryMatchesText(text, entry.text)) return undefined;
        const snapshot = await this.options.sources.exact(entry.sources, context);
        if (!snapshot.ok || !this.current(generation, context.generation) || !matchesSummary(entry, snapshot.value, this.options.hash)) return undefined;
        return { text: entry.text, excludedMessageIds: entry.sources.flatMap(source => [source.userMessageId, source.assistantMessageId]), generation };
      }, 200);
    } catch { return undefined; }
  }
  isCurrent(capture: SummaryCapture): boolean { return !this.disposed && capture.generation === this.generation && this.options.context() !== null; }
  interrupt(): void { this.generation++; this.selection = undefined; this.completed = undefined; this.abort?.abort(); if (!this.disabled) this.options.cache.invalidate(); }
  invalidate(): void { void this.clear(false, false); }
  deleteSummary(): Promise<SummaryResult<void>> { return this.clear(false); }
  reset(): Promise<SummaryResult<void>> { return this.clear(true); }
  private async clear(resetReceipt: boolean, explicit = true): Promise<SummaryResult<void>> {
    this.interrupt(); this.disabled = true; const sequence = ++this.clearSequence;
    const operation = this.options.cache.clear(resetReceipt, explicit); this.clearing = operation; const result = await operation;
    if (sequence === this.clearSequence && result.ok) this.disabled = false;
    return result.ok ? { ok: true, value: undefined } : failure('unavailable');
  }
  dispose(): void { this.interrupt(); this.disposed = true; this.options.cache.dispose(); }
  private current(generation: number, memoryGeneration: number): boolean { return !this.disposed && this.generation === generation && this.options.context()?.generation === memoryGeneration; }
  private async validate(entry: SummaryEntry, generation: number): Promise<boolean> {
    const context = this.options.context(); if (!context) return false;
    return this.bounded(async () => { await this.options.beforeRead(); const snapshot = await this.options.sources.exact(entry.sources, context); return snapshot.ok && this.current(generation, context.generation) && matchesSummary(entry, snapshot.value, this.options.hash); }, 200);
  }
  private async bounded<T>(operation: () => Promise<T>, ms: number, timeout?: () => void): Promise<T> {
    let timer: unknown;
    try { return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = this.options.scheduler.setTimeout(() => { timeout?.(); reject(new Error('Summary deadline')); }, ms); })]); }
    finally { this.options.scheduler.clearTimeout(timer); }
  }
}
