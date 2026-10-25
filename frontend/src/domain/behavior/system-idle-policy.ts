export type SystemPresence = 'active' | 'inactive' | 'probably_away' | 'unknown';

interface PositiveBaseline {
  readonly nowMs: number;
  readonly wallNowMs: number;
  readonly idleMs: number;
  readonly presence: SystemPresence;
}

/** Session-only state. Consumers use presence/systemPresenceAt, not continuity fields. */
export interface SystemIdleState {
  readonly generation: number;
  readonly sequence: number;
  readonly presence: SystemPresence;
  readonly baseline: PositiveBaseline | null;
  readonly highAtMs: number | null;
  readonly activeObserved: boolean;
  readonly returnArmed: boolean;
}

interface SystemIdleInput {
  readonly generation: number;
  readonly sequence: number;
  readonly nowMs: number;
  readonly wallNowMs: number;
  readonly idleMs: number | null;
  readonly unconfirmed?: boolean;
  readonly armingAllowed: boolean;
}

const FRESH_MS = 2_500;
const SAMPLE_INTERVAL_MS = 1_000;
const ACTIVE_REENTER_MS = 30_000;
const INACTIVE_ENTER_MS = 60_000;
const AWAY_ENTER_MS = 300_000;
const AWAY_EXIT_MS = 240_000;
const RETURN_MAX_MS = 5_000;

export function createSystemIdleState(generation: number): SystemIdleState {
  return {
    generation, sequence: -1, presence: 'unknown', baseline: null,
    highAtMs: null, activeObserved: false, returnArmed: false,
  };
}

export function systemPresenceAt(state: SystemIdleState, nowMs: number): SystemPresence {
  if (!state.baseline || !Number.isFinite(nowMs)) return 'unknown';
  const ageMs = nowMs - state.baseline.nowMs;
  return ageMs >= 0 && ageMs <= FRESH_MS ? state.presence : 'unknown';
}

function validIdle(idleMs: number | null): idleMs is number {
  return idleMs !== null && Number.isSafeInteger(idleMs) && idleMs > 0 && idleMs % 1_000 === 0;
}

function discontinuous(baseline: PositiveBaseline, input: SystemIdleInput): boolean {
  const elapsedMs = input.nowMs - baseline.nowMs;
  const wallElapsedMs = input.wallNowMs - baseline.wallNowMs;
  return elapsedMs < 0 || elapsedMs > FRESH_MS || wallElapsedMs < 0
    || Math.abs(wallElapsedMs - elapsedMs) > SAMPLE_INTERVAL_MS
    || (validIdle(input.idleMs) && input.idleMs - baseline.idleMs > elapsedMs + SAMPLE_INTERVAL_MS);
}

function classify(previous: SystemPresence, idleMs: number, confirmedHigh: boolean): SystemPresence {
  if (previous === 'probably_away') {
    if (idleMs <= ACTIVE_REENTER_MS) return 'active';
    return idleMs < AWAY_EXIT_MS ? 'inactive' : 'probably_away';
  }
  if (previous === 'active') return idleMs >= INACTIVE_ENTER_MS ? 'inactive' : 'active';
  if (idleMs <= ACTIVE_REENTER_MS) return 'active';
  return previous === 'inactive' && confirmedHigh ? 'probably_away' : 'inactive';
}

export function updateSystemIdle(
  state: SystemIdleState,
  input: SystemIdleInput,
): { readonly state: SystemIdleState; readonly returned: boolean } {
  if (input.generation !== state.generation || !Number.isSafeInteger(input.sequence)
      || input.sequence < 0 || input.sequence <= state.sequence) {
    return { state, returned: false };
  }

  const empty = { ...createSystemIdleState(state.generation), sequence: input.sequence };
  const clocksValid = Number.isFinite(input.nowMs) && Number.isFinite(input.wallNowMs);
  const positive = validIdle(input.idleMs);
  if (!clocksValid || (state.baseline && discontinuous(state.baseline, input))) {
    // The invalidating sample is only a new guard baseline, never presence evidence.
    const baseline = clocksValid && positive ? {
      nowMs: input.nowMs, wallNowMs: input.wallNowMs, idleMs: input.idleMs, presence: 'unknown' as const,
    } : null;
    return { state: { ...empty, baseline }, returned: false };
  }

  if (!positive) {
    if (input.idleMs === null && input.unconfirmed && state.baseline) {
      return {
        state: {
          ...state, sequence: input.sequence, presence: 'unknown', highAtMs: null,
          activeObserved: input.armingAllowed && state.activeObserved,
          returnArmed: input.armingAllowed && state.returnArmed,
        },
        returned: false,
      };
    }
    return { state: empty, returned: false };
  }

  const previous = state.baseline?.presence ?? 'unknown';
  const highSeparationMs = state.highAtMs === null ? null : input.nowMs - state.highAtMs;
  const confirmedHigh = input.idleMs >= AWAY_ENTER_MS && highSeparationMs !== null
    && highSeparationMs >= SAMPLE_INTERVAL_MS && highSeparationMs <= FRESH_MS;
  const presence = classify(previous, input.idleMs, confirmedHigh);
  const exitedAway = previous === 'probably_away' && presence !== 'probably_away';
  const returned = input.armingAllowed && exitedAway && state.returnArmed && input.idleMs <= RETURN_MAX_MS;
  const activeObserved = input.armingAllowed
    && (presence === 'active' || (!exitedAway && state.activeObserved));
  const returnArmed = input.armingAllowed && presence === 'probably_away'
    && (previous === 'probably_away' ? state.returnArmed : state.activeObserved);

  return {
    state: {
      generation: state.generation, sequence: input.sequence, presence,
      baseline: { nowMs: input.nowMs, wallNowMs: input.wallNowMs, idleMs: input.idleMs, presence },
      highAtMs: input.idleMs >= AWAY_ENTER_MS ? input.nowMs : null,
      activeObserved, returnArmed,
    },
    returned,
  };
}
