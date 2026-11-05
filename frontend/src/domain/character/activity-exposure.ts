import type { CausalObservedEvent } from './causal-affect';

/** Volatile exposure, separate from enduring preferences and relationships. */
export interface ActivityExposure {
  readonly satiation: number;
  readonly habituation: number;
  readonly highWaterSequence: number;
  readonly lastMonotonicMs: number | null;
  readonly habituationDecayAtMs: number | null;
}

export function createActivityExposure(): ActivityExposure {
  return { satiation: 0, habituation: 0, highWaterSequence: 0, lastMonotonicMs: null, habituationDecayAtMs: null };
}

function validTime(state: ActivityExposure, nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0 && (state.lastMonotonicMs === null || nowMs >= state.lastMonotonicMs);
}

export function recoverActivityExposure(state: ActivityExposure, nowMs: number): ActivityExposure {
  if (!validTime(state, nowMs)) return state;
  const dt = state.lastMonotonicMs === null ? 0 : Math.min(60_000, nowMs - state.lastMonotonicMs);
  const periods = state.habituationDecayAtMs === null ? 0 : Math.floor((nowMs - state.habituationDecayAtMs) / 30_000);
  const habituation = Math.max(0, state.habituation - periods);
  return { ...state, satiation: Math.max(0, state.satiation - dt / 300_000), habituation,
    lastMonotonicMs: nowMs, habituationDecayAtMs: habituation === 0 ? null : state.habituationDecayAtMs! + periods * 30_000 };
}

/** Contact must already be classified as non-interrupting by the trusted ingress. */
export function observeActivityExposure(state: ActivityExposure, event: CausalObservedEvent, nowMs: number): ActivityExposure {
  if (!validTime(state, nowMs) || !Number.isSafeInteger(event.sequence) || event.sequence <= state.highWaterSequence
      || !Number.isFinite(event.executedMs) || event.executedMs < 0) return state;
  const next = { ...recoverActivityExposure(state, nowMs), highWaterSequence: event.sequence };
  if (event.activity === 'cursor_game' && event.activityRunId && event.outcome !== null) {
    return { ...next, satiation: Math.min(1, next.satiation + Math.min(event.executedMs, 30_000) / 60_000) };
  }
  if (event.cause === 'contact' && event.source === 'user' && event.activity === null && event.activityRunId === null
      && event.outcome === null && event.executedMs === 0) {
    return { ...next, habituation: Math.min(4, next.habituation + 1), habituationDecayAtMs: next.habituationDecayAtMs ?? nowMs };
  }
  return next;
}

export function cursorGameSatiationMultiplier(satiation: number | undefined): number {
  return 1 - .75 * (Number.isFinite(satiation) ? Math.max(0, Math.min(1, satiation!)) : 0);
}
