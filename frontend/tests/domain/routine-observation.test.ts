import { describe, expect, it } from 'vitest';
import {
  RoutineObservationAggregator,
  type RoutineAggregationSample,
} from '../../src/domain/behavior/routine-observation';

const BASE_UTC = Date.UTC(2026, 9, 26, 12);
function sample(nowMs: number, changes: Partial<RoutineAggregationSample> = {}): RoutineAggregationSample {
  return {
    nowMs, utcMs: BASE_UTC + nowMs, zoneId: 'Europe/London', offsetMinutes: 0,
    localDate: '2026-10-26', continuity: 1, sequence: nowMs + 1,
    presence: 'active', positiveAvailable: true, ...changes,
  };
}

describe('routine observation semantic aggregation', () => {
  it.each([
    ['active', 'activeMs'], ['inactive', 'inactiveMs'], ['probably_away', 'awayMs'],
  ] as const)('counts only the observed positive %s interval', (presence, field) => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0, { presence }));
    aggregator.sample(sample(1000, { presence }));
    const row = aggregator.flush();
    expect(row).toMatchObject({ startUtcMs: BASE_UTC, endUtcMs: BASE_UTC + 1000, [field]: 1000, unknownMs: 0 });
    expect(row && row.activeMs + row.inactiveMs + row.awayMs + row.unknownMs).toBe(1000);
    expect(Object.isFrozen(row)).toBe(true);
  });

  it('startup and reset do not emit empty rows or join runs', () => {
    const aggregator = new RoutineObservationAggregator();
    expect(aggregator.flush()).toBeNull();
    aggregator.sample(sample(0));
    expect(aggregator.flush()).toBeNull();
    aggregator.sample(sample(1000));
    aggregator.sample(sample(2000));
    aggregator.reset();
    aggregator.sample(sample(8000));
    aggregator.sample(sample(9000));
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC + 8000, activeMs: 1000 });
    expect(aggregator.flush()).toBeNull();
  });

  it('marks presence transitions unknown, without fragmenting the bucket', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    expect(aggregator.sample(sample(1000, { presence: 'inactive' })).closed).toBeNull();
    aggregator.sample(sample(2000, { presence: 'inactive' }));
    expect(aggregator.flush()).toMatchObject({ activeMs: 0, inactiveMs: 1000, unknownMs: 1000 });
  });

  it.each(['zero', 'unavailable', 'unknown'] as const)('does not bridge %s readings', (kind) => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000));
    aggregator.sample(sample(2000, kind === 'unknown' ? { presence: 'unknown' } : { positiveAvailable: false }));
    aggregator.sample(sample(3000));
    aggregator.sample(sample(4000));
    expect(aggregator.flush()).toMatchObject({ activeMs: 2000, unknownMs: 2000 });
  });

  it('continual unavailable readings produce one unknown row per UTC bucket', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0, { positiveAvailable: false }));
    const closed = [];
    for (let ms = 1000; ms <= 300_000; ms += 1000) {
      const result = aggregator.sample(sample(ms, { positiveAvailable: false }));
      if (result.closed) closed.push(result.closed);
    }
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ activeMs: 0, unknownMs: 300_000 });
    expect(aggregator.flush()).toBeNull();
  });

  it('a continuity reset drops pair evidence, without flushing the aggregate', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    expect(aggregator.sample(sample(1000, { continuity: 2, sequence: 1 })).closed).toBeNull();
    aggregator.sample(sample(2000, { continuity: 2, sequence: 2 }));
    expect(aggregator.flush()).toMatchObject({ activeMs: 1000, unknownMs: 1000 });
  });

  it('repeated and older sequences cannot extend coverage or replace the baseline', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0, { sequence: 5 }));
    aggregator.sample(sample(1000, { sequence: 5, positiveAvailable: false }));
    aggregator.sample(sample(2000, { sequence: 4, presence: 'probably_away' }));
    aggregator.sample(sample(2500, { sequence: 6 }));
    expect(aggregator.flush()).toMatchObject({ activeMs: 2500, unknownMs: 0 });
  });

  it('gaps above 2500ms are unknown and require a fresh subsequent pair', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(2501));
    aggregator.sample(sample(3501));
    expect(aggregator.flush()).toMatchObject({ activeMs: 1000, unknownMs: 2501 });
  });

  it('splits one classified pair exactly at a UTC five-minute boundary', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(299_000));
    const result = aggregator.sample(sample(301_000));
    expect(result.closed).toMatchObject({ startUtcMs: BASE_UTC + 299_000, endUtcMs: BASE_UTC + 300_000, activeMs: 1000 });
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC + 300_000, endUtcMs: BASE_UTC + 301_000, activeMs: 1000 });
  });

  it('does not manufacture rows across hours of missing sampling', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(299_000));
    const result = aggregator.sample(sample(10_800_000));
    expect(result.closed).toMatchObject({ endUtcMs: BASE_UTC + 300_000, unknownMs: 1000, activeMs: 0 });
    expect(aggregator.flush()).toBeNull();
  });

  it.each([
    { nowMs: 900, utcMs: BASE_UTC + 900 },
    { nowMs: 2000, utcMs: BASE_UTC + 500 },
    { nowMs: 2000, utcMs: BASE_UTC + 3001 },
    { nowMs: Number.NaN, utcMs: BASE_UTC + 2000 },
  ])('flushes the last known sample and signals a hard clock break: %j', (clock) => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000));
    const result = aggregator.sample(sample(2000, clock));
    expect(result).toMatchObject({ discontinuity: 'clock', closed: { endUtcMs: BASE_UTC + 1000, activeMs: 1000 } });
    expect(aggregator.flush()).toBeNull();
  });

  it('accepts bounded wall jitter while keeping durations monotonic', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000, { utcMs: BASE_UTC + 2000 }));
    aggregator.sample(sample(2000, { utcMs: BASE_UTC + 2000 }));
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC, endUtcMs: BASE_UTC + 2000, activeMs: 2000 });
  });

  it('signals zone changes without consuming the new-calendar input', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000));
    expect(aggregator.sample(sample(2000, { zoneId: 'Asia/Tokyo', offsetMinutes: 540 }))).toMatchObject({
      discontinuity: 'zone', closed: { endUtcMs: BASE_UTC + 1000 },
    });
    expect(aggregator.flush()).toBeNull();
    aggregator.sample(sample(3000, { zoneId: 'Asia/Tokyo', offsetMinutes: 540 }));
    aggregator.sample(sample(4000, { zoneId: 'Asia/Tokyo', offsetMinutes: 540 }));
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC + 3000, zoneId: 'Asia/Tokyo', activeMs: 1000 });
  });

  it.each([{ offsetMinutes: 60 }, { localDate: '2026-10-27' }])('splits DST/local-day without a cohort break: %j', (calendar) => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000));
    expect(aggregator.sample(sample(2000, calendar))).toMatchObject({ discontinuity: null, closed: { activeMs: 1000 } });
    aggregator.sample(sample(3000, calendar));
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC + 2000, activeMs: 1000, ...calendar });
  });

  it('does not substitute UTC for unknown calendar capability', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0, { zoneId: null }));
    aggregator.sample(sample(1000, { zoneId: null }));
    expect(aggregator.flush()).toBeNull();
    aggregator.sample(sample(2000));
    aggregator.sample(sample(3000, { zoneId: null }));
    expect(aggregator.flush()).toBeNull();
  });

  it('explicit lifecycle flush does not extrapolate or connect the following run', () => {
    const aggregator = new RoutineObservationAggregator();
    aggregator.sample(sample(0));
    aggregator.sample(sample(1000));
    expect(aggregator.flush()).toMatchObject({ endUtcMs: BASE_UTC + 1000 });
    aggregator.sample(sample(30_000));
    aggregator.sample(sample(31_000));
    expect(aggregator.flush()).toMatchObject({ startUtcMs: BASE_UTC + 30_000, activeMs: 1000 });
  });
});
