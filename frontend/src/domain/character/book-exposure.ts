/** Volatile book satiation has no contact habituation or persisted preference state. */
export interface BookExposure {
  readonly satiation: number;
  readonly highWaterSequence: number;
  readonly lastMonotonicMs: number | null;
}
export interface BookExposureTerminal {
  readonly sequence: number;
  readonly activity: string | null;
  readonly activityRunId: string | null;
  readonly outcome: string | null;
  readonly executedMs: number;
}
export function createBookExposure(): BookExposure {
  return { satiation: 0, highWaterSequence: 0, lastMonotonicMs: null };
}
function validTime(state: BookExposure, nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0 && (state.lastMonotonicMs === null || nowMs >= state.lastMonotonicMs);
}
export function recoverBookExposure(state: BookExposure, nowMs: number): BookExposure {
  if (!validTime(state, nowMs)) return state;
  const dt = state.lastMonotonicMs === null ? 0 : Math.min(60_000, nowMs - state.lastMonotonicMs);
  return { ...state, satiation: Math.max(0, state.satiation - dt / 300_000), lastMonotonicMs: nowMs };
}
/** Trusted actual terminals only; the shared causal sequence suppresses replay. */
export function observeBookExposure(state: BookExposure, event: BookExposureTerminal, nowMs: number): BookExposure {
  if (!validTime(state, nowMs) || !Number.isSafeInteger(event.sequence) || event.sequence <= state.highWaterSequence
    || !Number.isFinite(event.executedMs) || event.executedMs < 0 || event.executedMs > 600_000) return state;
  const next = { ...recoverBookExposure(state, nowMs), highWaterSequence: event.sequence };
  if (event.activity !== 'book' || !event.activityRunId
    || (event.outcome !== 'completed' && event.outcome !== 'cancelled' && event.outcome !== 'failed')) return next;
  return { ...next, satiation: Math.min(1, next.satiation + Math.min(event.executedMs, 30_000) / 60_000) };
}
