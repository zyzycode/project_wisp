import { recognizeMemoryFact } from './memory-fact-registry';
import { causalRecallBucket } from '../../domain/character/causal-recall';
import { crossDayGameObservation } from '../../domain/character/cross-day-game-observation';
import type { ICausalSourceReadBarrier, ILifeHistoryReader, ILifeReflectionRuntime, LifeReflectionCapture } from '../ports/life-history.interface';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';

interface Options {
  readonly reader?: ILifeHistoryReader;
  readonly barrier: ICausalSourceReadBarrier;
  readonly context: () => MemoryOperationContext | null;
  readonly timestamp: () => string;
  readonly scheduler: MemoryScheduler;
}
/** One volatile observation; no startup replay, generated text, learning or background reads. */
export class LifeReflectionRuntime implements ILifeReflectionRuntime {
  private cache: LifeReflectionCapture | undefined;
  private epoch = 0;
  private disposed = false;
  private reading = false;
  private lastClock = '';
  constructor(private readonly options: Options) {}
  invalidate(): void { this.epoch++; this.cache = undefined; }
  dispose(): void { this.invalidate(); this.disposed = true; }
  private clock(): string | undefined {
    const now = this.options.timestamp();
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(now) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) { this.invalidate(); return undefined; }
    if (now < this.lastClock) { this.invalidate(); return undefined; }
    this.lastClock = now;
    return now;
  }
  isCurrent(capture: LifeReflectionCapture): boolean {
    const now = this.clock(), state = this.options.barrier.snapshot(), context = this.options.context();
    return !this.disposed && this.cache === capture && !!now && now.slice(0, 10) === capture.asOf.slice(0, 10)
      && context?.generation === capture.memoryGeneration && state.generation === capture.memoryGeneration && state.revision === capture.sourceRevision && !state.pending;
  }
  async capture(queryText: string): Promise<LifeReflectionCapture | undefined> {
    if (recognizeMemoryFact(queryText)) return undefined;
    const bucket = causalRecallBucket(queryText);
    if (this.disposed || (bucket !== 'game.any' && bucket !== 'game.completed.user_engaged') || !this.options.reader || this.reading) return undefined;
    if (this.cache && this.isCurrent(this.cache)) return this.cache;
    this.cache = undefined;
    const epoch = this.epoch;
    this.reading = true;
    let timer: unknown;
    let expired = false;
    const read = (async () => {
      await this.options.barrier.whenSettled();
      const context = this.options.context(), state = this.options.barrier.snapshot(), asOf = this.clock();
      if (!context || !asOf || state.pending || state.generation !== context.generation || epoch !== this.epoch || expired || this.disposed) return undefined;
      const throughDateUTC = asOf.slice(0, 10), fromDateUTC = new Date(Date.parse(`${throughDateUTC}T00:00:00.000Z`) - 13 * 86400000).toISOString().slice(0, 10);
      const result = await this.options.reader!.readWindow({ fromDateUTC, throughDateUTC, asOf }, context);
      const after = this.options.barrier.snapshot(), now = this.clock();
      if (!result.ok || result.value.coverage !== 'complete' || epoch !== this.epoch || expired || this.disposed || !now || now.slice(0, 10) !== throughDateUTC
        || this.options.context()?.generation !== context.generation || after.generation !== state.generation || after.revision !== state.revision || after.pending) return undefined;
      const observation = crossDayGameObservation(result.value.events, fromDateUTC, throughDateUTC);
      if (!observation) return undefined;
      const capture: LifeReflectionCapture = { memoryGeneration: context.generation, sourceRevision: state.revision, asOf, observation,
        sources: result.value.events.map(e => ({ appRunId: e.appRunId, sequence: e.sequence, revision: 1 })) };
      this.cache = capture; return capture;
    })().catch(() => undefined).finally(() => { this.reading = false; });
    const timeout = new Promise<undefined>(resolve => { timer = this.options.scheduler.setTimeout(() => { expired = true; resolve(undefined); }, 200); });
    try { return await Promise.race([read, timeout]); } finally { this.options.scheduler.clearTimeout(timer); }
  }
}
