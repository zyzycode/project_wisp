import { describe, expect, it } from 'vitest';
import {
  aggregateRoutineAvailability, type RoutineAvailabilityInput, type RoutineAvailabilityRow,
} from '../../src/domain/behavior/routine-availability';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TODAY = Date.parse('2026-11-05T00:00:00Z');
const dateAgo = (days: number) => new Date(TODAY - days * DAY).toISOString().slice(0, 10);
function dayRows(daysAgo: number, positive = true, offsetMinutes = 0): RoutineAvailabilityRow[] {
  const localDate = dateAgo(daysAgo);
  const start = TODAY - daysAgo * DAY + 6 * HOUR - offsetMinutes * 60_000;
  return Array.from({ length: 48 }, (_, index) => ({
    datasetEpoch: 'epoch', cohortId: 'cohort', startUtcMs: start + index * 300_000,
    endUtcMs: start + (index + 1) * 300_000, zoneId: 'Europe/London', offsetMinutes,
    localDate, tuningId: 'AFK-A01-v1', activeMs: positive && index < 12 ? 300_000 : 0,
    inactiveMs: positive && index < 12 ? 0 : 300_000, awayMs: 0, unknownMs: 0,
  }));
}
function input(rows = Array.from({ length: 14 }, (_, index) => dayRows(index + 1)).flat(), changes: Partial<RoutineAvailabilityInput> = {}): RoutineAvailabilityInput {
  return {
    datasetEpoch: 'epoch', cohortId: 'cohort', zoneId: 'Europe/London', offsetMinutes: 0,
    nowUtcMs: TODAY + 7 * HOUR, currentLocalDate: '2026-11-05', windowStartHour: 6,
    rows, ...changes,
  };
}
const aggregate = (rows: readonly RoutineAvailabilityRow[]) => aggregateRoutineAvailability(input([...rows]));
function patchFirst(rows: RoutineAvailabilityRow[], change: Partial<RoutineAvailabilityRow>): RoutineAvailabilityRow[] {
  return rows.map((row, index) => index === 0 ? { ...row, ...change } : row);
}

describe('bounded routine availability evidence', () => {
  it('accepts exactly 14 of 28 eligible dates, without inventing the uncovered dates', () => {
    expect(aggregateRoutineAvailability(input())).toEqual({
      windowStartHour: 6, eligibleDays: 14, positiveDays: 14, recentPositiveDays: 7,
      observedThroughDate: '2026-11-04', qualifies: true,
    });
  });
  it('does not require a predecessor or complete history', () => {
    expect(aggregateRoutineAvailability(input([]))).toMatchObject({ eligibleDays: 0, observedThroughDate: null, qualifies: false });
    expect(aggregate(dayRows(1))).toMatchObject({ eligibleDays: 1, qualifies: false });
    expect(aggregate(input().rows.slice(48))).toMatchObject({ eligibleDays: 13, qualifies: false });
  });
  it('uses exact 70% with no rounding', () => {
    const rows = Array.from({ length: 20 }, (_, index) => dayRows(index + 1, index < 14)).flat();
    expect(aggregate(rows)).toMatchObject({ eligibleDays: 20, positiveDays: 14, qualifies: true });
    expect(aggregate([...rows, ...dayRows(21, false)])).toMatchObject({ eligibleDays: 21, positiveDays: 14, qualifies: false });
  });
  it('uses the last seven eligible dates, including gaps, and requires five positives', () => {
    const rows = Array.from({ length: 20 }, (_, index) => dayRows(index + 1, index >= 3)).flat();
    expect(aggregate(rows)).toMatchObject({ recentPositiveDays: 4, qualifies: false });
    expect(aggregate([...rows.filter((row) => row.localDate !== dateAgo(3)), ...dayRows(3)])).toMatchObject({ recentPositiveDays: 5, qualifies: true });
  });
  it('requires 4h classified rather than unknown or row-span coverage', () => {
    const rows = [...input().rows];
    expect(aggregate(patchFirst(rows, { activeMs: 299_999, unknownMs: 1 }))).toMatchObject({ eligibleDays: 13, qualifies: false });
    const unknown = rows.map((row) => ({ ...row, activeMs: 0, inactiveMs: 0, unknownMs: 300_000 }));
    expect(aggregate(unknown)).toMatchObject({ eligibleDays: 0, positiveDays: 0 });
    expect(aggregate(rows.map((row) => ({ ...row, awayMs: row.inactiveMs, inactiveMs: 0 })))).toMatchObject({ eligibleDays: 14, qualifies: true });
  });
  it('requires at least 1h active for each positive date', () => {
    expect(aggregate(patchFirst([...input().rows], { activeMs: 299_999, inactiveMs: 1 }))).toMatchObject({ eligibleDays: 14, positiveDays: 13, recentPositiveDays: 6 });
  });
  it('expires latest eligible evidence after seven calendar days', () => {
    expect(aggregate(Array.from({ length: 14 }, (_, index) => dayRows(index + 7)).flat())).toMatchObject({ qualifies: true });
    expect(aggregate(Array.from({ length: 14 }, (_, index) => dayRows(index + 8)).flat())).toMatchObject({ qualifies: false });
  });
  it('accepts all 28 completed dates and rejects out-of-range input', () => {
    expect(aggregate(Array.from({ length: 28 }, (_, index) => dayRows(index + 1)).flat())).toMatchObject({ eligibleDays: 28, qualifies: true });
    expect(aggregate(dayRows(29))).toBeNull();
    expect(aggregate(dayRows(0))).toBeNull();
  });
  it('is independent of row order and never mutates frozen evidence', () => {
    const rows = Object.freeze([...input().rows].reverse().map((row) => Object.freeze(row)));
    expect(aggregateRoutineAvailability(input([], { rows }))).toEqual(aggregateRoutineAvailability(input()));
    expect(rows[0]?.localDate).toBe(dateAgo(14));
  });
  it('omits a different-offset date and both observed transition endpoints', () => {
    const rows = [...input().rows.filter((row) => row.localDate !== dateAgo(8)), ...dayRows(8, true, 60)];
    expect(aggregate(rows)).toMatchObject({ eligibleDays: 11, positiveDays: 11, qualifies: false });
  });
  it('excludes transition endpoint and intervening gap dates without treating gaps as errors', () => {
    const rows = [...dayRows(20, true, 60), ...dayRows(10), ...dayRows(1)];
    expect(aggregate(rows)).toMatchObject({ eligibleDays: 1, observedThroughDate: dateAgo(1), qualifies: false });
  });
  it('counts the indexed predecessor, which can exclude the first transition endpoint', () => {
    const rows = [...dayRows(28), ...input().rows];
    const predecessor = dayRows(29, true, 60).at(-1);
    expect(aggregateRoutineAvailability(input(rows, { predecessor }))).toMatchObject({ eligibleDays: 14, qualifies: true });
    expect(aggregateRoutineAvailability(input(rows))).toMatchObject({ eligibleDays: 15 });
  });
  it('excludes mixed-offset days even when no transition occurs inside the selected window', () => {
    const extra = dayRows(1, true, 60)[0];
    if (!extra) throw new Error('fixture');
    const evening = { ...extra, startUtcMs: extra.startUtcMs + 12 * HOUR, endUtcMs: extra.endUtcMs + 12 * HOUR };
    expect(aggregate([...input().rows, evening])).toMatchObject({ eligibleDays: 13 });
  });
  it('allows exact window-end rows but never prorates a boundary-straddling bin', () => {
    const rows = dayRows(1).map((row) => ({ ...row, startUtcMs: row.startUtcMs + 2 * HOUR, endUtcMs: row.endUtcMs + 2 * HOUR }));
    expect(aggregate(rows)).toMatchObject({ eligibleDays: 1 });
    const offsetRows = dayRows(1, true, 1);
    // Capture boundaries are UTC five-minutes; the local 06:00 bin crosses the window start.
    const first = offsetRows[0];
    if (!first) throw new Error('fixture');
    const aligned = offsetRows.map((row) => ({ ...row, startUtcMs: row.startUtcMs + 60_000, endUtcMs: row.endUtcMs + 60_000 }));
    const straddle = { ...first, startUtcMs: first.startUtcMs - 240_000, endUtcMs: first.startUtcMs + 60_000 };
    expect(aggregateRoutineAvailability(input([...aligned.slice(0, 47), straddle], { offsetMinutes: 1 }))).toMatchObject({ eligibleDays: 0 });
  });
  it.each([
    { activeMs: -1 }, { activeMs: Number.NaN }, { unknownMs: 1 }, { endUtcMs: Number.POSITIVE_INFINITY },
    { localDate: '2026-02-30' }, { cohortId: 'other' }, { datasetEpoch: 'old' },
    { zoneId: 'Asia/Tokyo' }, { offsetMinutes: 841 }, { endUtcMs: TODAY + DAY },
  ])('rejects malformed, foreign or future evidence: %j', (change) => {
    expect(aggregate(patchFirst([...input().rows], change))).toBeNull();
  });
  it('rejects overlap, duplicates and oversized buckets rather than summing them', () => {
    const row = input().rows[0];
    if (!row) throw new Error('fixture');
    expect(aggregate([...input().rows, row])).toBeNull();
    expect(aggregate(patchFirst([...input().rows], { endUtcMs: row.endUtcMs + 1 }))).toBeNull();
  });
  it('rejects 10001 examined rows including predecessor before attempting aggregation', () => {
    const row = dayRows(1)[0];
    const predecessor = dayRows(29)[0];
    if (!row || !predecessor) throw new Error('fixture');
    expect(aggregateRoutineAvailability(input(Array.from({ length: 10_000 }, () => row), { predecessor }))).toBeNull();
  });
  it('does not treat a backwards local date across an observed offset change as malformed', () => {
    const template = dayRows(20)[0];
    if (!template) throw new Error('fixture');
    const before = { ...template, startUtcMs: Date.parse('2026-10-10T23:55:00Z'), endUtcMs: Date.parse('2026-10-11T00:00:00Z'), offsetMinutes: 60, localDate: '2026-10-11' };
    const after = { ...template, startUtcMs: Date.parse('2026-10-11T00:00:00Z'), endUtcMs: Date.parse('2026-10-11T00:05:00Z'), offsetMinutes: -60, localDate: '2026-10-10' };
    expect(aggregate([...input().rows, before, after])).toMatchObject({ eligibleDays: 13, qualifies: false });
  });
  it('accepts exactly 10000 valid examined rows', () => {
    const rows = Array.from({ length: 28 }, (_, day) => dayRows(day + 1)).flat().flatMap((row) =>
      Array.from({ length: 8 }, (_, part) => ({
        ...row, startUtcMs: row.startUtcMs + part * 37_500, endUtcMs: row.startUtcMs + (part + 1) * 37_500,
        activeMs: row.activeMs / 8, inactiveMs: row.inactiveMs / 8,
      }))).slice(0, 10_000);
    expect(aggregate(rows)).toMatchObject({ qualifies: true });
  });
  it('rejects inconsistent current calendar and window without reading a system clock', () => {
    expect(aggregateRoutineAvailability(input([], { currentLocalDate: '2026-11-04' }))).toBeNull();
    expect(aggregateRoutineAvailability(input([], { windowStartHour: 12 }))).toBeNull();
    expect(aggregateRoutineAvailability(input([], { nowUtcMs: Number.NaN }))).toBeNull();
  });
});
