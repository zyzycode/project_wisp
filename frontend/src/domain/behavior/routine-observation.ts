/** Semantic capture only: persistence identities belong to the Application owner. */
export interface RoutineAggregationSample {
  readonly nowMs: number;
  readonly utcMs: number;
  readonly zoneId: string | null;
  readonly offsetMinutes: number;
  readonly localDate: string;
  readonly continuity: number;
  readonly sequence: number;
  readonly presence: 'active' | 'inactive' | 'probably_away' | 'unknown';
  readonly positiveAvailable: boolean;
}

export interface RoutineAggregate {
  readonly startUtcMs: number;
  readonly endUtcMs: number;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly localDate: string;
  readonly tuningId: 'AFK-A01-v1';
  readonly activeMs: number;
  readonly inactiveMs: number;
  readonly awayMs: number;
  readonly unknownMs: number;
}

export interface RoutineAggregationResult {
  readonly closed: RoutineAggregate | null;
  /** The caller rotates cohort before accepting another fresh sample. */
  readonly discontinuity: 'clock' | 'zone' | null;
}

type DurationKey = 'activeMs' | 'inactiveMs' | 'awayMs' | 'unknownMs';
interface Segment {
  readonly startUtcMs: number;
  readonly startNowMs: number;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly localDate: string;
  endUtcMs: number;
  activeMs: number;
  inactiveMs: number;
  awayMs: number;
  unknownMs: number;
}

const BUCKET_MS = 300_000;
const EMPTY: RoutineAggregationResult = Object.freeze({ closed: null, discontinuity: null });

function hasCalendar(sample: RoutineAggregationSample): sample is RoutineAggregationSample & { zoneId: string } {
  return typeof sample.zoneId === 'string' && sample.zoneId.length > 0
    && sample.zoneId.length <= 100 && Number.isInteger(sample.offsetMinutes)
    && Math.abs(sample.offsetMinutes) <= 840 && /^\d{4}-\d{2}-\d{2}$/.test(sample.localDate);
}

function classifiedKey(previous: RoutineAggregationSample, current: RoutineAggregationSample): DurationKey {
  if (!previous.positiveAvailable || !current.positiveAvailable
    || previous.continuity !== current.continuity || previous.presence !== current.presence
    || current.nowMs - previous.nowMs > 2500) return 'unknownMs';
  switch (current.presence) {
    case 'active': return 'activeMs';
    case 'inactive': return 'inactiveMs';
    case 'probably_away': return 'awayMs';
    case 'unknown': return 'unknownMs';
  }
}

/** No timers, system clocks, queues or extrapolation beyond the supplied sample. */
export class RoutineObservationAggregator {
  private segment: Segment | null = null;
  private previous: RoutineAggregationSample | null = null;

  sample(input: RoutineAggregationSample): RoutineAggregationResult {
    const previous = this.previous;
    if (previous && input.continuity === previous.continuity && input.sequence <= previous.sequence) return EMPTY;
    if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.utcMs)) {
      return this.breakSegment('clock');
    }
    if (!hasCalendar(input)) {
      const closed = this.flush();
      return { closed, discontinuity: null };
    }
    if (previous) {
      const elapsed = input.nowMs - previous.nowMs;
      const wallElapsed = input.utcMs - previous.utcMs;
      if (elapsed < 0 || wallElapsed < 0 || Math.abs(wallElapsed - elapsed) > 1000) {
        return this.breakSegment('clock');
      }
      if (previous.zoneId !== input.zoneId) return this.breakSegment('zone');
    }
    const segment = this.segment;
    if (!segment || !previous) {
      this.start(input);
      return EMPTY;
    }
    if (segment.localDate !== input.localDate || segment.offsetMinutes !== input.offsetMinutes) {
      const closed = this.flush();
      this.start(input);
      return { closed, discontinuity: null };
    }
    // Calendar timestamps stay anchored to monotonic duration throughout this segment.
    const endUtcMs = segment.startUtcMs + input.nowMs - segment.startNowMs;
    const boundary = (Math.floor(segment.startUtcMs / BUCKET_MS) + 1) * BUCKET_MS;
    const key = classifiedKey(previous, input);
    this.previous = { ...input };
    if (endUtcMs < boundary) {
      this.extend(endUtcMs, key);
      return EMPTY;
    }
    this.extend(boundary, key);
    const closed = this.snapshot();
    this.segment = null;
    if (endUtcMs >= boundary + BUCKET_MS) {
      // A delayed sampler must not manufacture rows for intervening buckets.
      this.start(input);
    } else {
      this.start(input, boundary, input.nowMs - (endUtcMs - boundary));
      this.extend(endUtcMs, key);
    }
    return { closed, discontinuity: null };
  }

  /** Close at the last supplied sample; shutdown/lifecycle adds no guessed tail. */
  flush(): RoutineAggregate | null {
    const closed = this.snapshot();
    this.reset();
    return closed;
  }

  reset(): void {
    this.segment = null;
    this.previous = null;
  }

  private breakSegment(discontinuity: 'clock' | 'zone'): RoutineAggregationResult {
    return { closed: this.flush(), discontinuity };
  }

  private start(input: RoutineAggregationSample & { zoneId: string }, utcMs = input.utcMs, nowMs = input.nowMs): void {
    this.previous = { ...input };
    this.segment = {
      startUtcMs: utcMs, startNowMs: nowMs, endUtcMs: utcMs,
      zoneId: input.zoneId, offsetMinutes: input.offsetMinutes, localDate: input.localDate,
      activeMs: 0, inactiveMs: 0, awayMs: 0, unknownMs: 0,
    };
  }

  private extend(endUtcMs: number, key: DurationKey): void {
    const segment = this.segment;
    if (!segment) return;
    const elapsed = endUtcMs - segment.endUtcMs;
    if (elapsed > 0) {
      segment[key] += elapsed;
      segment.endUtcMs = endUtcMs;
    }
  }

  private snapshot(): RoutineAggregate | null {
    const segment = this.segment;
    if (!segment || segment.endUtcMs <= segment.startUtcMs) return null;
    return Object.freeze({
      startUtcMs: segment.startUtcMs, endUtcMs: segment.endUtcMs,
      zoneId: segment.zoneId, offsetMinutes: segment.offsetMinutes, localDate: segment.localDate,
      tuningId: 'AFK-A01-v1', activeMs: segment.activeMs, inactiveMs: segment.inactiveMs,
      awayMs: segment.awayMs, unknownMs: segment.unknownMs,
    });
  }
}
