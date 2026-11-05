/** Verified local facts. Application binds these to the accepted input and activity run. */
export interface CausalObservedEvent {
  readonly sequence: number;
  readonly source: 'user' | 'system' | 'autonomy' | 'unknown';
  readonly triggerSequence: number | null;
  readonly activityRunId: string | null;
  readonly activity: 'cursor_game' | null;
  readonly outcome: 'completed' | 'cancelled' | 'failed' | null;
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout' | 'other' | 'unknown';
  readonly executedMs: number;
  readonly participation: 'user_engaged' | 'solitary' | 'none';
}

export interface CausalEmotion {
  readonly causeSequence: number;
  readonly cause: CausalObservedEvent['cause'];
  readonly kind: 'content' | 'curious' | 'irritated';
  readonly intensity: number;
  readonly target: 'user' | 'environment' | 'self';
}

export interface CausalAffectState {
  readonly emotion: CausalEmotion | null;
  readonly interruptionTimes: readonly number[];
  readonly highWaterSequence: number;
  readonly lastMonotonicMs: number | null;
}

export function createCausalAffectState(): CausalAffectState {
  return { emotion: null, interruptionTimes: [], highWaterSequence: 0, lastMonotonicMs: null };
}

function validTime(state: CausalAffectState, nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0 && (state.lastMonotonicMs === null || nowMs >= state.lastMonotonicMs);
}

export function decayCausalAffect(state: CausalAffectState, nowMs: number): CausalAffectState {
  if (!validTime(state, nowMs)) return state;
  const elapsed = state.lastMonotonicMs === null ? 0 : Math.min(nowMs - state.lastMonotonicMs, 60_000);
  const intensity = (state.emotion?.intensity ?? 0) * 2 ** (-elapsed / 30_000);
  return { ...state, lastMonotonicMs: nowMs,
    interruptionTimes: state.interruptionTimes.filter(time => nowMs - time < 60_000),
    emotion: state.emotion && intensity >= 0.05 ? { ...state.emotion, intensity } : null };
}

/** No Needs, relationship, consent, personality or activity effects are paid here. */
export function appraiseCausalEvent(state: CausalAffectState, event: CausalObservedEvent, nowMs: number): CausalAffectState {
  if (!validTime(state, nowMs) || !Number.isSafeInteger(event.sequence) || event.sequence <= state.highWaterSequence
      || !Number.isFinite(event.executedMs) || event.executedMs < 0) return state;
  const next = { ...decayCausalAffect(state, nowMs), highWaterSequence: event.sequence };
  const makeEmotion = (kind: CausalEmotion['kind'], intensity: number, target: CausalEmotion['target']): CausalEmotion =>
    ({ causeSequence: event.sequence, cause: event.cause, kind, intensity, target });
  const trustedTrigger = event.source === 'user' && Number.isSafeInteger(event.triggerSequence) && event.triggerSequence !== null && event.triggerSequence > 0;
  if (event.cause === 'contact') {
    return event.source === 'user' && event.activity === null && event.activityRunId === null && event.outcome === null && event.executedMs === 0
      ? { ...next, emotion: makeEmotion('curious', 0.1, 'self') } : next;
  }
  if (event.activity !== 'cursor_game' || !event.activityRunId || event.outcome === null) return next;
  if (event.cause === 'completed' && event.outcome === 'completed' && event.participation === 'user_engaged') {
    return { ...next, emotion: makeEmotion('content', 0.2, 'user') };
  }
  if (event.cause === 'user_interrupted' && event.outcome === 'cancelled' && trustedTrigger && event.executedMs >= 1_000) {
    return { ...next, emotion: makeEmotion('irritated', Math.min(0.6, 0.2 + 0.1 * next.interruptionTimes.length), 'user'),
      interruptionTimes: [...next.interruptionTimes, nowMs].slice(-4) };
  }
  if (event.cause === 'environment_lost' || event.cause === 'timeout') {
    return { ...next, emotion: makeEmotion('irritated', 0.1, 'environment') };
  }
  return next;
}
