/** Immutable acknowledged observations only; no capture, clock or storage owner. */
export interface RoutineAvailabilityRow {
  readonly datasetEpoch: string;
  readonly cohortId: string;
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
export type RoutineAvailabilityWindow = 0 | 6 | 12 | 18;
export interface RoutineAvailabilityInput {
  readonly datasetEpoch: string;
  readonly cohortId: string;
  readonly zoneId: string;
  readonly offsetMinutes: number;
  readonly nowUtcMs: number;
  readonly currentLocalDate: string;
  readonly windowStartHour: RoutineAvailabilityWindow;
  readonly rows: readonly RoutineAvailabilityRow[];
  /** At most one indexed row before the 28-date range, counted in the same budget. */
  readonly predecessor?: RoutineAvailabilityRow;
}
export interface RoutineAvailabilityCounts {
  readonly windowStartHour: RoutineAvailabilityWindow;
  readonly eligibleDays: number;
  readonly positiveDays: number;
  readonly recentPositiveDays: number;
  readonly observedThroughDate: string | null;
  readonly qualifies: boolean;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BUCKET = 300_000;
const MAX_UTC = 8_639_999_000_000_000;
const dateOf = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);
const validUtc = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= MAX_UTC;
const validOffset = (value: number): boolean => Number.isInteger(value) && Math.abs(value) <= 840;
const validKey = (value: string): boolean => typeof value === 'string' && value.length > 0 && value.length <= 128;

function midnight(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const utcMs = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(utcMs) && dateOf(utcMs) === date ? utcMs : null;
}

function validRow(row: RoutineAvailabilityRow, input: RoutineAvailabilityInput): boolean {
  const span = row.endUtcMs - row.startUtcMs;
  if (!validUtc(row.startUtcMs) || !validUtc(row.endUtcMs) || span <= 0 || span > BUCKET
    || row.endUtcMs > input.nowUtcMs || row.datasetEpoch !== input.datasetEpoch
    || row.cohortId !== input.cohortId || row.zoneId !== input.zoneId
    || row.tuningId !== 'AFK-A01-v1' || !validOffset(row.offsetMinutes)
    || Math.floor(row.startUtcMs / BUCKET) !== Math.ceil(row.endUtcMs / BUCKET) - 1) return false;
  const durations = [row.activeMs, row.inactiveMs, row.awayMs, row.unknownMs];
  return durations.every((value) => Number.isFinite(value) && value >= 0 && value <= BUCKET)
    && durations.reduce((sum, value) => sum + value, 0) <= span + 1e-6
    && midnight(row.localDate) !== null
    && dateOf(row.startUtcMs + row.offsetMinutes * 60_000) === row.localDate
    && dateOf(Math.ceil(row.endUtcMs) - 1 + row.offsetMinutes * 60_000) === row.localDate;
}

/**
 * Missing dates, unknown time and window-straddling bins never become inactivity.
 * Worker callers also enforce serialized bytes and the shared recall deadline.
 */
export function aggregateRoutineAvailability(input: RoutineAvailabilityInput): RoutineAvailabilityCounts | null {
  const currentMidnight = midnight(input.currentLocalDate);
  if (currentMidnight === null || !validUtc(input.nowUtcMs) || !validOffset(input.offsetMinutes)
    || !validKey(input.datasetEpoch) || !validKey(input.cohortId) || !validKey(input.zoneId)
    || ![0, 6, 12, 18].includes(input.windowStartHour)
    || dateOf(input.nowUtcMs + input.offsetMinutes * 60_000) !== input.currentLocalDate
    || Math.floor(new Date(input.nowUtcMs + input.offsetMinutes * 60_000).getUTCHours() / 6) * 6 !== input.windowStartHour
    || input.rows.length + (input.predecessor ? 1 : 0) > 10_000) return null;
  const firstDate = dateOf(currentMidnight - 28 * DAY);
  const rows = input.predecessor ? [input.predecessor, ...input.rows] : [...input.rows];
  if (input.predecessor && input.predecessor.localDate >= firstDate) return null;
  if (input.rows.some((row) => row.localDate < firstDate || row.localDate >= input.currentLocalDate)
    || rows.some((row) => !validRow(row, input))) return null;
  rows.sort((a, b) => a.startUtcMs - b.startUtcMs);
  const excluded = new Set<string>();
  let previous: RoutineAvailabilityRow | undefined;
  for (const row of rows) {
    if (previous) {
      if (row.startUtcMs < previous.endUtcMs) return null;
      if (row.offsetMinutes !== previous.offsetMinutes) {
        // No transition calendar inference: exclude observed endpoints and the gap.
        for (let day = 0; day < 28; day++) {
          const date = dateOf(currentMidnight - (day + 1) * DAY);
          if (date >= (previous.localDate < row.localDate ? previous.localDate : row.localDate)
            && date <= (previous.localDate > row.localDate ? previous.localDate : row.localDate)) excluded.add(date);
        }
      }
    }
    if (row.offsetMinutes !== input.offsetMinutes) excluded.add(row.localDate);
    previous = row;
  }
  const coverage = new Map<string, { classified: number; active: number }>();
  for (const row of input.rows) {
    if (excluded.has(row.localDate)) continue;
    const localStart = row.startUtcMs + row.offsetMinutes * 60_000;
    const startOfDay = midnight(row.localDate);
    if (startOfDay === null) return null;
    const windowStart = startOfDay + input.windowStartHour * HOUR;
    if (localStart < windowStart || row.endUtcMs + row.offsetMinutes * 60_000 > windowStart + 6 * HOUR) continue;
    const day = coverage.get(row.localDate) ?? { classified: 0, active: 0 };
    day.classified += row.activeMs + row.inactiveMs + row.awayMs;
    day.active += row.activeMs;
    coverage.set(row.localDate, day);
  }
  const eligible = [...coverage.entries()].filter(([, day]) => day.classified >= 4 * HOUR)
    .sort(([a], [b]) => a.localeCompare(b));
  const positiveDays = eligible.filter(([, day]) => day.active >= HOUR).length;
  const recentPositiveDays = eligible.slice(-7).filter(([, day]) => day.active >= HOUR).length;
  const observedThroughDate = eligible.at(-1)?.[0] ?? null;
  const latestMidnight = observedThroughDate === null ? null : midnight(observedThroughDate);
  return Object.freeze({
    windowStartHour: input.windowStartHour, eligibleDays: eligible.length, positiveDays,
    recentPositiveDays, observedThroughDate,
    qualifies: eligible.length >= 14 && positiveDays * 10 >= eligible.length * 7
      && recentPositiveDays >= 5 && latestMidnight !== null && currentMidnight - latestMidnight <= 7 * DAY,
  });
}
