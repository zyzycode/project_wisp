import { recognizeMemoryFact } from './memory-fact-registry';
import { causalRecallBucket } from '../../domain/character/causal-recall';
import type { ICausalLifeRepository } from '../ports/causal-life.interface';
import type { ICausalSourceReadBarrier, ILifeHistoryReader, LifeSummaryEntry } from '../ports/life-history.interface';
import { lifeSummaryDigest, lifeSummaryEvent, lifeSummarySources, matchesLifeSummary, selectLifeSummary, validateLifeSummaryRange } from './life-summary-selection';
import { summaryPlainText } from '../../shared/summary-text-validation';
import type { ISummaryCache, ISummaryGenerator, ISummaryRuntime, ISummarySourceReader, SummaryCapture, ActiveSummaryEntry, ActiveSummaryReceipt, LifeSummaryRange, SummaryPreview, SummaryResult } from '../ports/summary';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import { factsDigest, matchesSummary, selectSummaryPairs, sourceMetadata, summaryMatchesText } from './summary-selection';
interface Options {
  readonly lifeHistory?: ILifeHistoryReader; readonly causalLife?: ICausalLifeRepository; readonly sourceBarrier?: ICausalSourceReadBarrier;
  readonly sources: ISummarySourceReader; readonly cache: ISummaryCache; readonly generator: ISummaryGenerator;
  readonly context: () => MemoryOperationContext | null; readonly now: () => number; readonly monotonicNow?: () => number; readonly createId: () => string;
  readonly hash: (text: string) => string; readonly scheduler: MemoryScheduler; readonly locale: 'ru' | 'en';
  readonly interruptObservation?: () => Promise<void>;
  readonly beforeRead: () => Promise<void>; readonly canGenerate: () => boolean;
}
interface Preview { readonly monotonicExpiresAt: number; readonly public: SummaryPreview; readonly entry: ActiveSummaryEntry; readonly generation: number; readonly memoryGeneration: number }
const failure = (code: 'unavailable' | 'busy' | 'stale' | 'rate_limited' | 'failed' | 'conflict'): SummaryResult<never> => ({ ok: false, code });
/** Explicit only: no startup/timer/chat inference. All async completions cross generation guards. */
export class SummaryRuntime implements ISummaryRuntime {
  private generation = 0;
  private reading = false;
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
  async preview(range?: LifeSummaryRange): Promise<SummaryResult<SummaryPreview>> {
    if (this.disposed || this.disabled || !this.options.canGenerate() || !this.options.context()) return failure('unavailable');
    if (this.pending) return failure('busy');
    const generation = this.generation, context = this.options.context()!;
    if (range) return this.lifePreview(range, generation, context);
    try {
      const result = await this.readBounded(async () => { await this.clearing; await this.options.beforeRead(); const cache = await this.options.cache.read(); return cache.ok ? this.options.sources.recent(context) : cache; }, 200);
      if (!this.current(generation, context.generation)) return failure('stale');
      if (!result.ok) return failure('unavailable');
      const pairs = selectSummaryPairs(result.value.pairs); if (pairs.length < 4) return failure('unavailable');
      const sources = sourceMetadata(pairs, this.options.hash);
      const entry: ActiveSummaryEntry = { mode: 'dialogue_pairs', text: 'preview', sources, sourceDigest: this.options.hash(JSON.stringify(sources)), factsDigest: factsDigest(result.value, this.options.hash), locale: this.options.locale, generatorVersion: 1 };
      const publicPreview = { previewId: this.options.createId(), expiresAt: this.options.now() + 120000, pairs: pairs.map(({ userText, assistantText }) => ({ userText, assistantText })) };
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
    if (cache.value.receipt?.commandId === commandId && (cache.value.receipt.sourceDigest !== entry.sourceDigest || cache.value.receipt.mode !== entry.mode)) return failure('conflict');
    if (cache.value.entry?.sourceDigest === entry.sourceDigest && cache.value.entry.mode === entry.mode && cache.value.entry.locale === this.options.locale && await this.validate(cache.value.entry, preview.generation)) return { ok: true, value: cache.value.entry.text };
    if (cache.value.receipt?.commandId === commandId) return failure('failed');
    const now = this.options.now();
    if (cache.value.receipt && now - cache.value.receipt.admittedAt < 86400000) return failure('rate_limited');
    const receipt: ActiveSummaryReceipt = entry.mode === 'life_events'
      ? { mode: 'life_events', commandId, requestId: this.options.createId(), sourceDigest: entry.sourceDigest, admittedAt: now, generatorVersion: 2 }
      : { mode: 'dialogue_pairs', commandId, requestId: this.options.createId(), sourceDigest: entry.sourceDigest, admittedAt: now, generatorVersion: 1 };
    const epoch = this.options.cache.invalidate();
    const written = await this.options.cache.write({ formatVersion: 2, entry: null, receipt }, epoch);
    if (!valid()) return failure('stale');
    if (!written.ok) return failure('unavailable');
    // Source revalidation follows durable receipt too; mutation cannot sneak into dispatch.
    if (!await this.validate(entry, preview.generation) || !valid()) return failure('stale');
    const source = 'events' in preview.public
      ? { fromDate: preview.public.fromDateUTC, throughDate: preview.public.throughDateUTC, events: preview.public.events }
      : { pairs: preview.public.pairs };
    const text = summaryPlainText(await this.options.generator.generateSummary({ requestId: receipt.requestId, locale: this.options.locale, ...source }, controller.signal), 1200);
    if (!valid() || !await this.validate(entry, preview.generation) || !valid()) return failure('stale');
    const saved = await this.options.cache.write({ formatVersion: 2, entry: { ...entry, text }, receipt }, epoch);
    if (!valid()) return failure('stale');
    return saved.ok ? { ok: true, value: text } : failure('unavailable');
  }
  async capture(text: string): Promise<SummaryCapture | undefined> {
    const generation = this.generation, context = this.options.context(); if (!context || this.disposed || this.disabled) return undefined;
    try {
      return await this.readBounded(async alive => {
        await this.clearing; await this.options.beforeRead();
        const cache = await this.options.cache.read();
        if (!alive() || !cache.ok || !cache.value.entry || !this.current(generation, context.generation)) return undefined;
        const entry = cache.value.entry;
        if (entry.locale !== this.options.locale) return undefined;
        if (entry.mode === 'life_events') {
          if (recognizeMemoryFact(text)) return undefined;
          const bucket = causalRecallBucket(text);
          if (bucket !== 'game.any' && bucket !== 'game.completed.user_engaged') return undefined;
          const events = await this.resolveLife(entry, context);
          if (!events || !this.current(generation, context.generation)) return undefined;
          return { text: entry.text, excludedMessageIds: [], generation, memoryGeneration: context.generation, life: { fromDateUTC: entry.fromDateUTC, throughDateUTC: entry.throughDateUTC, eventCount: events.length, sources: entry.sources.map(({ appRunId, sequence, revision }) => ({ appRunId, sequence, revision })), gameRuns: events.flatMap(e => e.activityRunId ? [{ appRunId: e.appRunId, activityRunId: e.activityRunId }] : []) } };
        }
        if (!summaryMatchesText(text, entry.text)) return undefined;
        const snapshot = await this.options.sources.exact(entry.sources, context);
        if (!snapshot.ok || !this.current(generation, context.generation) || !matchesSummary(entry, snapshot.value, this.options.hash)) return undefined;
        return { text: entry.text, excludedMessageIds: entry.sources.flatMap(source => [source.userMessageId, source.assistantMessageId]), generation, memoryGeneration: context.generation };
      }, 200);
    } catch { return undefined; }
  }
  isCurrent(capture: SummaryCapture): boolean { return !this.disposed && capture.generation === this.generation && this.options.context() !== null && (capture.memoryGeneration === undefined || capture.memoryGeneration === this.options.context()?.generation); }
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
  private async validate(entry: ActiveSummaryEntry, generation: number): Promise<boolean> {
    const context = this.options.context(); if (!context) return false;
    if (entry.mode === 'life_events') return this.readBounded(async () => { const events = await this.resolveLife(entry, context); return !!events && this.current(generation, context.generation); }, 200);
    return this.readBounded(async () => { await this.options.beforeRead(); const snapshot = await this.options.sources.exact(entry.sources, context); return snapshot.ok && this.current(generation, context.generation) && matchesSummary(entry, snapshot.value, this.options.hash); }, 200);
  }
  private async lifePreview(range: LifeSummaryRange, generation: number, context: MemoryOperationContext): Promise<SummaryResult<SummaryPreview>> {
    if (!this.options.lifeHistory || !this.options.causalLife) return failure('unavailable');
    try {
      validateLifeSummaryRange(range.fromDateUTC, range.throughDateUTC, new Date(this.options.now()).toISOString());
      const result = await this.readBounded(async alive => {
        await this.clearing;
        await Promise.all([this.options.beforeRead(), this.options.sourceBarrier?.whenSettled()]);
        const sourceState = this.options.sourceBarrier?.snapshot();
        if (!alive() || !this.current(generation, context.generation) || sourceState?.pending || (sourceState && sourceState.generation !== context.generation)) return undefined;
        const cache = await this.options.cache.read(); if (!alive() || !cache.ok) return undefined;
        const asOf = new Date(this.options.now()).toISOString();
        const window = await this.options.lifeHistory!.readWindow({ fromDateUTC: range.fromDateUTC, throughDateUTC: range.throughDateUTC, asOf }, context);
        return window.ok && window.value.coverage === 'complete' ? selectLifeSummary(window.value.events) : undefined;
      }, 200);
      if (!this.current(generation, context.generation)) return failure('stale');
      if (!result || result.length < 4) return failure('unavailable');
      const sources = lifeSummarySources(result, this.options.hash);
      const base = { mode: 'life_events' as const, locale: this.options.locale, fromDateUTC: range.fromDateUTC, throughDateUTC: range.throughDateUTC, sources };
      const entry: LifeSummaryEntry = { ...base, text: 'preview', sourceDigest: lifeSummaryDigest(base, this.options.hash), generatorVersion: 2 };
      const publicPreview: SummaryPreview = { mode: 'life_events', previewId: this.options.createId(), expiresAt: this.options.now() + 120000, fromDateUTC: range.fromDateUTC, throughDateUTC: range.throughDateUTC, events: result.flatMap(e => { const event = lifeSummaryEvent(e); return event ? [event] : []; }) };
      this.selection = { monotonicExpiresAt: (this.options.monotonicNow ?? this.options.now)() + 120000, public: publicPreview, entry, generation, memoryGeneration: context.generation };
      return { ok: true, value: publicPreview };
    } catch { return failure('unavailable'); }
  }
  private async resolveLife(entry: LifeSummaryEntry, context: MemoryOperationContext) {
    if (!this.options.causalLife) return undefined;
    const refs = entry.sources.map(({ appRunId, sequence, revision }) => ({ appRunId, sequence, revision }));
    const result = await this.options.causalLife.resolveSources(refs, context);
    return result.ok && matchesLifeSummary(entry, result.value, this.options.hash) ? result.value : undefined;
  }
  /** A timed-out proof keeps its slot until settlement; no repeated exact-read queue. */
  private async readBounded<T>(operation: (alive: () => boolean) => Promise<T>, ms: number): Promise<T> {
    if (this.reading) throw new Error('Summary proof busy');
    this.reading = true;
    let expired = false;
    return this.bounded(() => operation(() => !expired).finally(() => { this.reading = false; }), ms, () => { expired = true; });
  }
  private async bounded<T>(operation: () => Promise<T>, ms: number, timeout?: () => void): Promise<T> {
    let timer: unknown;
    try { return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = this.options.scheduler.setTimeout(() => { timeout?.(); reject(new Error('Summary deadline')); }, ms); })]); }
    finally { this.options.scheduler.clearTimeout(timer); }
  }
}
