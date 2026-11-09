import type { IRoutineHypothesisRepository, RoutineEvidencePage, RoutineHypothesisCapture, RoutineSourceSnapshot, RoutineWindowStart } from '../ports/world-context.interface';
import type { MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
export interface RoutineCalendar {
  readonly utcMs: number;
  readonly localDate: string;
  readonly zoneId: string | null;
  readonly offsetMinutes: number;
  readonly windowStartHour: RoutineWindowStart;
}
export interface RoutineHypothesisPreview {
  readonly sharing: boolean;
  readonly available: boolean;
  readonly suppressed: boolean;
  readonly windowStartHour: RoutineWindowStart;
  readonly counts: RoutineEvidencePage['counts'];
}
/** Volatile consent and source-bound projection; no recording, timers or autonomous reads. */
export class RoutineHypothesisRuntime {
  private epoch = 0;
  private sharing = false;
  private reading = false;
  private disposed = false;
  private blocked = new Set<RoutineWindowStart>();
  private cancelRead: (() => void) | undefined;
  private lastWall = 0;
  private lastMono = 0;
  private clockBlockedSource: string | undefined;
  private suppressionRevision = 0;
  constructor(private readonly options: {
    readonly repository?: IRoutineHypothesisRepository;
    readonly source: () => RoutineSourceSnapshot | null;
    readonly whenSettled: () => Promise<void>;
    readonly context: () => MemoryOperationContext | null;
    readonly calendar: () => RoutineCalendar;
    readonly now: () => number;
    readonly scheduler: MemoryScheduler;
    readonly suppress: (window: RoutineWindowStart, suppressed: boolean) => Promise<MemoryResult<void>>;
    readonly changed?: () => void;
  }) {}
  invalidate(): void { this.epoch++; this.cancelRead?.(); this.options.changed?.(); }
  endSession(): void { this.sharing = false; this.invalidate(); }
  setSharing(value: boolean): void { this.sharing = value; this.invalidate(); }
  reset(): void { this.suppressionRevision++; this.blocked.clear(); this.clockBlockedSource = undefined; this.lastWall = 0; this.lastMono = 0; this.endSession(); }
  dispose(): void { this.suppressionRevision++; this.endSession(); this.disposed = true; }
  private clock(): RoutineCalendar | null {
    const calendar = this.options.calendar(), now = this.options.now();
    const bad = !Number.isFinite(now) || !Number.isFinite(calendar.utcMs) || now < this.lastMono || calendar.utcMs < this.lastWall
      || (this.lastWall !== 0 && Math.abs((calendar.utcMs - this.lastWall) - (now - this.lastMono)) > 1000);
    this.lastMono = now; this.lastWall = calendar.utcMs;
    const source = JSON.stringify(this.options.source());
    if (bad) { this.clockBlockedSource = source; this.invalidate(); return null; }
    if (this.clockBlockedSource === source) return null;
    this.clockBlockedSource = undefined;
    return calendar;
  }
  private key(calendar: RoutineCalendar): string { return `${calendar.localDate}/${calendar.windowStartHour}/${calendar.zoneId}/${calendar.offsetMinutes}`; }
  private sameSource(source: RoutineSourceSnapshot): boolean { return JSON.stringify(source) === JSON.stringify(this.options.source()); }
  isCurrent(capture: RoutineHypothesisCapture): boolean {
    const calendar = this.clock();
    return !this.disposed && this.sharing && !this.blocked.has(capture.context.windowStartHour)
      && capture.epoch === this.epoch && capture.generation === this.options.context()?.generation
      && !!calendar && capture.calendarKey === this.key(calendar) && this.sameSource(capture.source);
  }
  async prepare(deadlineMs: number): Promise<RoutineHypothesisCapture | undefined> {
    if (!this.sharing) return undefined;
    const result = await this.read(deadlineMs);
    if (!result || result.page.suppressed || this.blocked.has(result.calendar.windowStartHour) || !result.page.counts?.qualifies || !result.page.counts.observedThroughDate) return undefined;
    const counts = result.page.counts;
    const capture: RoutineHypothesisCapture = { epoch:result.epoch, generation:result.generation, source:result.source,
      calendarKey:this.key(result.calendar), context:{ scope:'while_wisp_running', validity:'tentative',
        windowStartHour:counts.windowStartHour, eligibleDays:counts.eligibleDays, positiveDays:counts.positiveDays,
        recentPositiveDays:counts.recentPositiveDays, observedThroughDate:counts.observedThroughDate! } };
    return this.isCurrent(capture) ? capture : undefined;
  }
  async preview(): Promise<RoutineHypothesisPreview> {
    const calendar = this.options.calendar();
    const result = await this.read(this.options.now() + 200);
    return { sharing:this.sharing, available:!!result, suppressed:this.blocked.has(calendar.windowStartHour) || result?.page.suppressed === true,
      windowStartHour:calendar.windowStartHour, counts:result?.page.counts ?? null };
  }
  async setSuppressed(window: RoutineWindowStart, suppressed: boolean): Promise<MemoryResult<void>> {
    // Safe RAM withdrawal survives missing acknowledgements and rollback.
    const revision = ++this.suppressionRevision;
    this.blocked.add(window); this.invalidate();
    const result = await this.options.suppress(window,suppressed);
    if (!this.disposed && revision === this.suppressionRevision && result.ok && !suppressed) { this.blocked.delete(window); this.invalidate(); }
    return result;
  }
  private async read(deadlineMs: number) {
    deadlineMs = Math.min(deadlineMs, this.options.now() + 200);
    const context = this.options.context(), repository = this.options.repository, epoch = this.epoch;
    if (this.disposed || this.reading || !context || !repository || this.options.now() >= deadlineMs) return undefined;
    this.reading = true;
    let expired = false, timer: unknown, cancel: (() => void) | undefined;
    const read = (async () => {
      await this.options.whenSettled();
      const source = this.options.source(), calendar = this.clock();
      if (expired || !source || !calendar || calendar.zoneId !== source.zoneId || calendar.offsetMinutes !== source.offsetMinutes
        || epoch !== this.epoch || context.generation !== this.options.context()?.generation || this.options.now() >= deadlineMs) return undefined;
      const result = await repository.readEvidence({ datasetEpoch:source.datasetEpoch, cohortId:source.cohortId,
        beforeLocalDate:calendar.localDate, windowStartHour:calendar.windowStartHour, zoneId:source.zoneId,
        offsetMinutes:source.offsetMinutes, nowUtcMs:calendar.utcMs,
        expiresAtUtcMs:calendar.utcMs + Math.max(0,Math.min(200,deadlineMs - this.options.now())) },context);
      const currentCalendar = this.clock();
      if (expired || !result.ok || epoch !== this.epoch || context.generation !== this.options.context()?.generation
        || !this.sameSource(source) || !currentCalendar || this.key(calendar) !== this.key(currentCalendar)
        || this.options.now() >= deadlineMs) return undefined;
      return { page:result.value, source, calendar, epoch, generation:context.generation };
    })().catch(() => undefined).finally(() => { this.reading = false; });
    const timeout = new Promise<undefined>(resolve => {
      cancel = () => { expired = true; resolve(undefined); };
      this.cancelRead = cancel;
      timer = this.options.scheduler.setTimeout(cancel,Math.max(0,deadlineMs - this.options.now()));
    });
    try { return await Promise.race([read,timeout]); }
    finally { this.options.scheduler.clearTimeout(timer); if (this.cancelRead === cancel) this.cancelRead = undefined; }
  }
}
