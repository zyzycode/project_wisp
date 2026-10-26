import { RoutineObservationAggregator, type RoutineAggregate } from '../../domain/behavior/routine-observation';
import type { IRoutineObservationRepository, RoutineCaptureIdentity, RoutineSample } from '../ports/routine-observation.port';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';
import type { RoutineStatusDTO } from '../../shared/ipc-contracts';

/** One pending persistence operation and one current aggregate; no retry/backfill queue. */
export class RoutineCapture {
  private readonly aggregator = new RoutineObservationAggregator();
  private identity: RoutineCaptureIdentity | null = null;
  private generation: number | null = null;
  private token = 0;
  private sequence = 0;
  private pending: Promise<void> | null = null;
  private failed = false;
  private rotate = false;
  private lastSampleAt: number | null = null;
  private status: RoutineStatusDTO = { source: 'unknown', storage: 'initializing', lastAcknowledgedAt: null };
  constructor(private readonly options: {
    readonly repository: IRoutineObservationRepository;
    readonly context: () => MemoryOperationContext | null;
    readonly storageMode: () => 'initializing' | 'persistent' | 'volatile';
    readonly createId: () => string;
    readonly appRunId: string;
    readonly now?: () => number;
  }) {}
  getStatus(): RoutineStatusDTO {
    const mode = this.options.storageMode();
    const age = this.lastSampleAt === null ? Infinity : (this.options.now?.() ?? this.lastSampleAt) - this.lastSampleAt;
    return { ...this.status, ...(age < 0 || age > 2500 ? { source: 'unknown' as const } : {}), ...(mode !== 'persistent' ? { storage: mode } : {}) };
  }
  /** Synchronous generation barrier; a later receipt retains its original identity. */
  invalidate(): void {
    this.token++; this.identity = null; this.generation = null; this.failed = false;
    this.aggregator.reset();
  }
  resetCommitted(): void {
    this.invalidate(); this.rotate = false;
    this.status = { ...this.status, lastAcknowledgedAt: null };
  }
  sample(sample: RoutineSample, source: RoutineStatusDTO['source']): void {
    this.lastSampleAt = sample.nowMs;
    this.status = { ...this.status, source };
    const context = this.options.context();
    if (!context) { this.aggregator.reset(); return; }
    if (this.generation !== context.generation) this.invalidate();
    if (!this.identity) {
      if (!this.pending && !this.failed && sample.zoneId !== null) this.begin(sample, context);
      return;
    }
    const update = this.aggregator.sample(sample);
    if (update.closed) this.append(update.closed, context);
    if (update.discontinuity !== null) {
      this.rotate = true; this.identity = null; this.aggregator.reset();
    }
  }
  private begin(sample: RoutineSample, context: MemoryOperationContext): void {
    const token = this.token;
    this.generation = context.generation;
    const input = { atUtcMs: sample.utcMs, zoneId: sample.zoneId!, offsetMinutes: sample.offsetMinutes,
      candidateCohortId: this.options.createId(), forceNewCohort: this.rotate };
    this.pending = (async () => {
      try {
        const result = await this.options.repository.begin(input, context);
        if (!this.current(token, context)) return;
        if (!result.ok) { this.failed = true; this.degrade(); return; }
        this.identity = result.value; this.rotate = false;
        const status = await this.options.repository.readStatus(context);
        if (!this.current(token, context)) return;
        if (!status.ok) { this.failed = true; this.identity = null; this.degrade(); return; }
        this.status = { ...this.status, storage: 'persistent', lastAcknowledgedAt: status.value.latestEndUtcMs === null ? null : new Date(status.value.latestEndUtcMs).toISOString() };
      } catch { if (this.current(token, context)) { this.failed = true; this.identity = null; this.degrade(); } }
    })().finally(() => { this.pending = null; });
  }
  private current(token: number, context: MemoryOperationContext): boolean {
    return token === this.token && this.options.context()?.generation === context.generation;
  }
  private degrade(): void { this.status = { ...this.status, storage: 'degraded' }; }
  private append(aggregate: RoutineAggregate, context: MemoryOperationContext): void {
    if (!this.identity || this.failed) return;
    if (this.pending) { this.degrade(); return; }
    const record = { ...aggregate, ...this.identity, appRunId: this.options.appRunId, sequence: ++this.sequence };
    const token = this.token;
    this.pending = (async () => {
      try {
        const result = await this.options.repository.append(record, context);
        if (!this.current(token, context)) return;
        if (result.ok) this.status = { ...this.status, lastAcknowledgedAt: new Date(record.endUtcMs).toISOString() };
        else { this.failed = true; this.degrade(); }
      } catch { if (this.current(token, context)) { this.failed = true; this.degrade(); } }
    })().finally(() => { this.pending = null; });
  }
  clockDiscontinuity(): void {
    this.boundary(); this.invalidate(); this.rotate = true;
  }
  boundary(): void {
    this.lastSampleAt = null; this.status = { ...this.status, source: 'unknown' };
    const aggregate = this.aggregator.flush();
    const context = this.options.context();
    if (aggregate && context && this.generation === context.generation) this.append(aggregate, context);
    this.aggregator.reset();
  }
  async shutdown(): Promise<void> { this.boundary(); await this.pending; }
}
